import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";

import { accountInWorkspace, requireAction, UUID } from "../auth/access";
import { NotFoundError } from "../auth/errors";
import type { Db } from "../auth/members";
import {
  INBOX_KINDS,
  INBOX_STATUSES,
  inboxItems,
  type InboxStatus,
} from "../db/schema";
import { listInbox, parseIsoWithOffset } from "../providers/actions";
import { SocialApiError } from "../providers/socialapi/client";
import {
  UnsupportedError,
  ValidationError,
  type Capability,
  type InboxKind,
  type Platform,
  type SocialProvider,
} from "../providers/types";
import type { SecretBox } from "../security/secret-box";

export interface InboxItemView {
  id: string;
  socialAccountId: string;
  kind: InboxKind;
  externalId: string;
  author: string;
  text: string;
  receivedAt: Date;
  status: InboxStatus;
  handledBy: string | null;
}

const KIND_CAPABILITY: Record<InboxKind, Capability> = {
  dm: "dm",
  comment: "comments",
  review: "reviews",
  mention: "mentions",
};
const MAX_TEXT = 10_000;
const MAX_AUTHOR = 200;
const SAFE_CODE = /^[a-z0-9_.-]{1,64}$/i;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const view = (r: typeof inboxItems.$inferSelect): InboxItemView => ({
  id: r.id,
  socialAccountId: r.socialAccountId,
  kind: r.kind,
  externalId: r.externalId,
  author: r.author,
  text: r.text,
  receivedAt: r.receivedAt,
  status: r.status,
  handledBy: r.handledBy,
});

function errorCodeOf(e: unknown): string {
  if (e instanceof SocialApiError)
    return SAFE_CODE.test(e.code) ? e.code : "upstream_error";
  if (e instanceof ValidationError) return "validation";
  return "internal";
}

function encodeCursor(row: { receivedAt: Date; id: string }) {
  return Buffer.from(
    JSON.stringify({ t: row.receivedAt.toISOString(), id: row.id }),
  ).toString("base64url");
}

function decodeCursor(cursor: string): { t: Date; id: string } {
  try {
    const raw = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const ms =
      typeof raw?.t === "string" ? parseIsoWithOffset(raw.t) : undefined;
    if (ms === undefined || typeof raw.id !== "string" || !UUID.test(raw.id))
      throw new Error("cursor");
    return { t: new Date(ms), id: raw.id };
  } catch {
    throw new ValidationError("Cursor không hợp lệ");
  }
}

export interface InboxServiceDeps {
  db: Db;
  box: SecretBox;
  resolveProvider: (
    providerId: string,
    credentials: string,
  ) => SocialProvider | undefined;
}

export function createInboxService({
  db,
  box,
  resolveProvider,
}: InboxServiceDeps) {
  /** Kéo tin mới từ provider vào DB. Lặp lại an toàn: khoá duy nhất loại bản trùng, không ghi đè. */
  async function syncAccount(input: {
    workspaceId: string;
    accountId: string;
  }) {
    {
      const account = await accountInWorkspace(
        db,
        input.accountId,
        input.workspaceId,
      );
      const provider = resolveProvider(
        account.provider,
        box.decrypt(account.credentialsEnc),
      );
      const result = {
        inserted: 0,
        rejected: 0,
        skipped: [] as InboxKind[],
        failed: [] as { kind: InboxKind; code: string }[],
      };
      if (!provider) {
        result.failed.push({ kind: "dm", code: "provider_unavailable" });
        return result;
      }
      const platform = account.platform as Platform;
      const kinds = INBOX_KINDS.filter((k) =>
        provider.support[platform]?.includes(KIND_CAPABILITY[k]),
      );
      for (const kind of kinds) {
        let items;
        try {
          items = await listInbox(provider, {
            platform,
            accountId: account.externalId,
            kind,
          });
        } catch (e) {
          if (e instanceof UnsupportedError) result.skipped.push(kind);
          else result.failed.push({ kind, code: errorCodeOf(e) });
          continue;
        }
        const rows = [];
        for (const it of items) {
          const ms = parseIsoWithOffset(it.receivedAt);
          if (!it.id || ms === undefined || it.kind !== kind) {
            result.rejected++;
            continue;
          }
          rows.push({
            workspaceId: input.workspaceId,
            socialAccountId: account.id,
            kind,
            externalId: it.id,
            author: it.author.normalize("NFC").trim().slice(0, MAX_AUTHOR),
            text: it.text.normalize("NFC").slice(0, MAX_TEXT),
            receivedAt: new Date(ms),
          });
        }
        if (rows.length === 0) continue;
        const inserted = await db
          .insert(inboxItems)
          .values(rows)
          .onConflictDoNothing({
            target: [
              inboxItems.socialAccountId,
              inboxItems.kind,
              inboxItems.externalId,
            ],
          })
          .returning({ id: inboxItems.id });
        result.inserted += inserted.length;
      }
      return result;
    }
  }

  return {
    async sync(input: {
      actorId: string;
      workspaceId: string;
      accountId: string;
    }) {
      await requireAction(db, input.actorId, input.workspaceId, "inbox.read");
      return syncAccount(input);
    },

    /** Dành cho job nền (không có người dùng); chỉ gọi từ mã server, không đưa ra API. */
    syncAsSystem: syncAccount,

    /** Mới nhất trước; phân trang keyset (received_at, id) nên không sót/lặp khi có tin mới hoặc trùng giờ. */
    async list(input: {
      actorId: string;
      workspaceId: string;
      status?: InboxStatus;
      kind?: InboxKind;
      limit?: number;
      cursor?: string;
    }): Promise<{ items: InboxItemView[]; nextCursor: string | null }> {
      await requireAction(db, input.actorId, input.workspaceId, "inbox.read");
      const limit = Math.min(
        Math.max(Math.trunc(input.limit ?? DEFAULT_LIMIT) || 1, 1),
        MAX_LIMIT,
      );
      const conds: (SQL | undefined)[] = [
        eq(inboxItems.workspaceId, input.workspaceId),
        input.status && eq(inboxItems.status, input.status),
        input.kind && eq(inboxItems.kind, input.kind),
      ];
      if (input.cursor !== undefined) {
        const c = decodeCursor(input.cursor);
        conds.push(
          or(
            lt(inboxItems.receivedAt, c.t),
            and(eq(inboxItems.receivedAt, c.t), lt(inboxItems.id, c.id)),
          ),
        );
      }
      const rows = await db
        .select()
        .from(inboxItems)
        .where(and(...conds))
        .orderBy(desc(inboxItems.receivedAt), desc(inboxItems.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      return {
        items: page.map(view),
        nextCursor:
          rows.length > limit ? encodeCursor(page[page.length - 1]!) : null,
      };
    },

    async setStatus(input: {
      actorId: string;
      workspaceId: string;
      itemId: string;
      status: InboxStatus;
    }): Promise<InboxItemView> {
      await requireAction(db, input.actorId, input.workspaceId, "inbox.reply");
      if (!INBOX_STATUSES.includes(input.status))
        throw new ValidationError("Trạng thái không hợp lệ");
      if (!UUID.test(input.itemId)) throw new NotFoundError();
      const [row] = await db
        .update(inboxItems)
        .set({
          status: input.status,
          handledBy: input.status === "handled" ? input.actorId : null,
        })
        .where(
          and(
            eq(inboxItems.id, input.itemId),
            eq(inboxItems.workspaceId, input.workspaceId),
          ),
        )
        .returning();
      if (!row) throw new NotFoundError();
      return view(row);
    },
  };
}

export type InboxService = ReturnType<typeof createInboxService>;
