import { and, eq, isNotNull, sql } from "drizzle-orm";

import type { Db } from "../auth/members";
import {
  conversations,
  inboxItems,
  MESSAGE_DIRECTIONS,
  messages,
} from "../db/schema";
import {
  listConversations,
  listMessages,
  parseIsoWithOffset,
} from "../providers/actions";
import type {
  ConversationSummary,
  Platform,
  ProviderMessage,
  SocialProvider,
} from "../providers/types";

/** Trần mỗi lượt để một tài khoản/hội thoại quá nhiều tin không giữ job quá lâu; phần còn lại lượt sau làm tiếp. */
export const SYNC_LIMITS = {
  conversationPages: 5,
  messagePages: 5,
  backfillConversations: 10,
} as const;

/** Bản xem trước ở hộp thư; bản gốc đầy đủ nằm ở `messages.text`. */
const PREVIEW_MAX = 10_000;
const MAX_AUTHOR = 200;

export interface ConversationSyncAccount {
  /** Id `social_accounts` trong DB. */
  id: string;
  /** Id tài khoản bên nhà cung cấp. */
  externalId: string;
  platform: Platform;
}

export interface ConversationSyncResult {
  conversations: number;
  messages: number;
  /** Mục hộp thư được tạo mới hoặc cập nhật theo tin đến mới. */
  inboxUpdated: number;
  rejected: number;
  /** Hội thoại lỗi (chỉ mã an toàn); hội thoại khác vẫn chạy. */
  failed: { conversationId: string; code: string }[];
  /** Còn lịch sử chưa lấy hết (đã chạm trần trang); lượt sau đọc tiếp. */
  more: boolean;
}

type ConvRow = typeof conversations.$inferSelect;

const clean = (s: string) => s.normalize("NFC");

/** Tạo/cập nhật hội thoại; không lùi mốc tin gần nhất, không đụng mốc đồng bộ. Dùng chung cho đồng bộ và webhook. */
export async function upsertConversationRow(
  db: Db,
  input: {
    workspaceId: string;
    socialAccountId: string;
    conversation: ConversationSummary;
    lastMessageAt: Date | null;
  },
): Promise<ConvRow> {
  const c = input.conversation;
  const [row] = await db
    .insert(conversations)
    .values({
      workspaceId: input.workspaceId,
      socialAccountId: input.socialAccountId,
      externalId: c.id,
      participantId: clean(c.participantId),
      participantName: clean(c.participantName).trim().slice(0, MAX_AUTHOR),
      lastMessageAt: input.lastMessageAt,
    })
    .onConflictDoUpdate({
      target: [conversations.socialAccountId, conversations.externalId],
      set: {
        participantId: sql`excluded.participant_id`,
        participantName: sql`excluded.participant_name`,
        lastMessageAt: sql`greatest(${conversations.lastMessageAt}, excluded.last_message_at)`,
      },
    })
    .returning();
  return row!;
}

/**
 * Tin ĐẾN mới → mục hộp thư của hội thoại (khoá: id hội thoại). Tin cũ hơn tin mục đang hiển thị thì không đụng;
 * mới hơn thì cập nhật và mở lại mục đã xử lý. Trả số mục tạo/cập nhật.
 */
export async function touchDmInbox(
  db: Db,
  conv: Pick<
    ConvRow,
    "workspaceId" | "socialAccountId" | "externalId" | "participantName"
  >,
  latest: { author: string; text: string; sentAt: Date },
): Promise<number> {
  const rows = await db
    .insert(inboxItems)
    .values({
      workspaceId: conv.workspaceId,
      socialAccountId: conv.socialAccountId,
      kind: "dm",
      externalId: conv.externalId,
      author: latest.author || conv.participantName,
      text: latest.text.slice(0, PREVIEW_MAX),
      receivedAt: latest.sentAt,
    })
    .onConflictDoUpdate({
      target: [
        inboxItems.socialAccountId,
        inboxItems.kind,
        inboxItems.externalId,
      ],
      set: {
        author: sql`excluded.author`,
        text: sql`excluded.text`,
        receivedAt: sql`excluded.received_at`,
        status: "open",
        handledBy: null,
      },
      setWhere: sql`excluded.received_at > ${inboxItems.receivedAt}`,
    })
    .returning({ id: inboxItems.id });
  return rows.length;
}

/**
 * Đồng bộ DM theo hội thoại + tin nhắn (ADR-0002, H1). Lũy đẳng: tin khử trùng theo (tài khoản, external_id),
 * mục hộp thư chỉ cập nhật/mở lại khi có tin ĐẾN mới hơn tin nó đang hiển thị.
 *
 * Giả định của nhà cung cấp (docs/research §1): hội thoại trả theo tin gần nhất trước, tin trả mới nhất trước.
 */
export function createConversationSync({
  db,
  errorCode,
}: {
  db: Db;
  errorCode: (e: unknown) => string;
}) {
  const upsertConversation = (
    workspaceId: string,
    account: ConversationSyncAccount,
    c: ConversationSummary,
    lastMs: number | undefined,
  ) =>
    upsertConversationRow(db, {
      workspaceId,
      socialAccountId: account.id,
      conversation: c,
      lastMessageAt: lastMs === undefined ? null : new Date(lastMs),
    });
  const touchInbox = (
    conv: ConvRow,
    latest: { author: string; text: string; sentAt: Date },
  ) => touchDmInbox(db, conv, latest);

  /** Kiểm và chuẩn hoá một tin; undefined = loại (đếm rejected). */
  function toRow(
    conv: ConvRow,
    m: ProviderMessage,
  ): (typeof messages.$inferInsert & { sentAt: Date }) | undefined {
    const ms = parseIsoWithOffset(m.sentAt);
    if (
      !m.id ||
      ms === undefined ||
      !MESSAGE_DIRECTIONS.includes(m.direction) ||
      typeof m.text !== "string"
    )
      return undefined;
    const author =
      clean(m.author ?? "")
        .trim()
        .slice(0, MAX_AUTHOR) ||
      (m.direction === "incoming" ? conv.participantName : "");
    return {
      workspaceId: conv.workspaceId,
      conversationId: conv.id,
      socialAccountId: conv.socialAccountId,
      externalId: m.id,
      identityWeak: m.identityWeak,
      providerMessageId: m.providerMessageId || null,
      direction: m.direction,
      author,
      text: clean(m.text),
      sentAt: new Date(ms),
    };
  }

  /**
   * Đọc tin từ `cursor` (undefined = mới nhất) đi lùi tới mốc `stopBefore` (tin cũ hơn mốc là đã có) hoặc hết
   * trần trang. Trả cursor còn dở nếu chạm trần.
   */
  async function pullMessages(
    provider: SocialProvider,
    account: ConversationSyncAccount,
    conv: ConvRow,
    from: string | undefined,
    stopBefore: number | null,
    out: ConversationSyncResult,
  ) {
    let cursor = from;
    let newestMs: number | null = null;
    let latestIncoming: {
      author: string;
      text: string;
      sentAt: Date;
      ms: number;
    } | null = null;
    for (let page = 0; page < SYNC_LIMITS.messagePages; page++) {
      const res = await listMessages(provider, {
        platform: account.platform,
        accountId: account.externalId,
        conversationId: conv.externalId,
        cursor,
      });
      let reachedKnown = false;
      const rows = [];
      for (const m of res.items) {
        const row = toRow(conv, m);
        if (!row) {
          out.rejected++;
          continue;
        }
        // Bằng mốc vẫn lấy (có thể cùng mili giây với tin đã có); khoá duy nhất loại bản trùng.
        const ms = row.sentAt.getTime();
        if (stopBefore !== null && ms < stopBefore) {
          reachedKnown = true;
          continue;
        }
        rows.push(row);
        newestMs = Math.max(newestMs ?? ms, ms);
      }
      if (rows.length > 0) {
        const inserted = await db
          .insert(messages)
          .values(rows)
          .onConflictDoNothing({
            target: [messages.socialAccountId, messages.externalId],
          })
          .returning({
            direction: messages.direction,
            author: messages.author,
            text: messages.text,
            sentAt: messages.sentAt,
          });
        out.messages += inserted.length;
        for (const r of inserted) {
          const ms = r.sentAt.getTime();
          if (
            r.direction === "incoming" &&
            (latestIncoming === null || ms > latestIncoming.ms)
          )
            latestIncoming = { ...r, ms };
        }
      }
      if (reachedKnown || res.nextCursor === null)
        return { newestMs, latestIncoming, rest: null };
      cursor = res.nextCursor;
    }
    return { newestMs, latestIncoming, rest: cursor ?? null };
  }

  async function syncOne(
    provider: SocialProvider,
    account: ConversationSyncAccount,
    conv: ConvRow,
    lastMs: number | undefined,
    out: ConversationSyncResult,
  ) {
    const since = conv.syncedThrough?.getTime() ?? null;
    const r = await pullMessages(
      provider,
      account,
      conv,
      undefined,
      since,
      out,
    );
    if (r.latestIncoming)
      out.inboxUpdated += await touchInbox(conv, r.latestIncoming);

    const top = Math.max(
      r.newestMs ?? -Infinity,
      lastMs ?? -Infinity,
      since ?? -Infinity,
    );
    const syncedThrough = Number.isFinite(top)
      ? new Date(top)
      : conv.syncedThrough;
    if (r.rest === null) {
      await db
        .update(conversations)
        .set({ syncedThrough })
        .where(eq(conversations.id, conv.id));
      return;
    }
    out.more = true;
    if (conv.backfillCursor !== null) {
      // Đã có một khoảng lịch sử đang chờ: chỉ giữ được một cursor, nên không tiến mốc — lượt sau đọc lại từ đầu
      // (tin trùng bị khoá duy nhất loại), không để hở khoảng nào.
      return;
    }
    await db
      .update(conversations)
      .set({
        syncedThrough,
        backfillCursor: r.rest,
        backfillUntil: since === null ? null : new Date(since),
      })
      .where(eq(conversations.id, conv.id));
  }

  /** Đọc tiếp các khoảng lịch sử còn dở từ lượt trước. */
  async function backfill(
    provider: SocialProvider,
    account: ConversationSyncAccount,
    out: ConversationSyncResult,
  ) {
    const pending = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.socialAccountId, account.id),
          isNotNull(conversations.backfillCursor),
        ),
      )
      .orderBy(conversations.lastMessageAt)
      .limit(SYNC_LIMITS.backfillConversations + 1);
    if (pending.length > SYNC_LIMITS.backfillConversations) out.more = true;
    for (const conv of pending.slice(0, SYNC_LIMITS.backfillConversations)) {
      try {
        const r = await pullMessages(
          provider,
          account,
          conv,
          conv.backfillCursor!,
          conv.backfillUntil?.getTime() ?? null,
          out,
        );
        // Tin cũ không mở lại mục hộp thư, trừ khi hộp thư chưa có mục nào (touchInbox tự so thời gian).
        if (r.latestIncoming)
          out.inboxUpdated += await touchInbox(conv, r.latestIncoming);
        if (r.rest !== null) out.more = true;
        await db
          .update(conversations)
          .set({
            backfillCursor: r.rest,
            backfillUntil: r.rest === null ? null : conv.backfillUntil,
          })
          .where(eq(conversations.id, conv.id));
      } catch (e) {
        out.failed.push({
          conversationId: conv.externalId,
          code: errorCode(e),
        });
      }
    }
  }

  return {
    /**
     * Lỗi khi đọc danh sách hội thoại ném ra (tầng gọi ghi mã lỗi); lỗi của từng hội thoại được ghi vào `failed`
     * và không chặn hội thoại khác.
     */
    async syncAccount(
      workspaceId: string,
      account: ConversationSyncAccount,
      provider: SocialProvider,
    ): Promise<ConversationSyncResult> {
      const out: ConversationSyncResult = {
        conversations: 0,
        messages: 0,
        inboxUpdated: 0,
        rejected: 0,
        failed: [],
        more: false,
      };
      let cursor: string | undefined;
      pages: for (let page = 0; ; page++) {
        if (page >= SYNC_LIMITS.conversationPages) {
          out.more = true;
          break;
        }
        const res = await listConversations(provider, {
          platform: account.platform,
          accountId: account.externalId,
          cursor,
        });
        for (const c of res.items) {
          if (!c.id || !c.participantId) {
            out.rejected++;
            continue;
          }
          const lastMs =
            c.lastMessageAt === null
              ? undefined
              : parseIsoWithOffset(c.lastMessageAt);
          if (c.lastMessageAt !== null && lastMs === undefined) {
            out.rejected++;
            continue;
          }
          const conv = await upsertConversation(
            workspaceId,
            account,
            c,
            lastMs,
          );
          out.conversations++;
          // Danh sách theo tin gần nhất trước: gặp hội thoại không có gì mới thì các hội thoại sau cũng vậy.
          if (
            lastMs !== undefined &&
            conv.syncedThrough !== null &&
            lastMs <= conv.syncedThrough.getTime()
          )
            break pages;
          try {
            await syncOne(provider, account, conv, lastMs, out);
          } catch (e) {
            out.failed.push({ conversationId: c.id, code: errorCode(e) });
          }
        }
        if (res.nextCursor === null) break;
        cursor = res.nextCursor;
      }
      await backfill(provider, account, out);
      return out;
    },
  };
}

export type ConversationSync = ReturnType<typeof createConversationSync>;
