import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";

import { ConflictError, ForbiddenError, NotFoundError } from "../auth/errors";
import { getRole, type Db } from "../auth/members";
import { can } from "../auth/permissions";
import {
  posts,
  providerConnections,
  socialAccounts,
  type PostStatus,
} from "../db/schema";
import { publishPost as publishViaProvider } from "../providers/actions";
import { parseIsoWithOffset } from "../providers/actions";
import { SocialApiError } from "../providers/socialapi/client";
import {
  UnsupportedError,
  ValidationError,
  type Platform,
  type SocialProvider,
} from "../providers/types";
import type { SecretBox } from "../security/secret-box";

export interface PostView {
  id: string;
  workspaceId: string;
  socialAccountId: string;
  text: string;
  status: PostStatus;
  scheduledAt: Date;
  publishedAt: Date | null;
  errorCode: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_KEY = 128;
/** Mã lỗi lưu DB: chỉ ký tự an toàn, ngắn; không bao giờ chứa nội dung phía nhà cung cấp. */
const SAFE_CODE = /^[a-z0-9_.-]{1,64}$/i;

const view = (r: typeof posts.$inferSelect): PostView => ({
  id: r.id,
  workspaceId: r.workspaceId,
  socialAccountId: r.socialAccountId,
  text: r.text,
  status: r.status,
  scheduledAt: r.scheduledAt,
  publishedAt: r.publishedAt,
  errorCode: r.errorCode,
});

function errorCodeOf(e: unknown): string {
  if (e instanceof SocialApiError)
    return SAFE_CODE.test(e.code) ? e.code : "upstream_error";
  if (e instanceof UnsupportedError) return e.code;
  if (e instanceof ValidationError) return "validation";
  return "internal";
}

export interface PostServiceDeps {
  db: Db;
  box: SecretBox;
  now?: () => Date;
  /** Dựng provider từ id và khoá đã giải mã; `undefined` nếu provider không còn đăng ký. */
  resolveProvider: (
    providerId: string,
    credentials: string,
  ) => SocialProvider | undefined;
}

export function createPostService({
  db,
  box,
  now = () => new Date(),
  resolveProvider,
}: PostServiceDeps) {
  async function requireMember(
    actorId: string,
    workspaceId: string,
    action: "posts.publish" | "inbox.read",
  ) {
    if (!can(await getRole(db, workspaceId, actorId), action))
      throw new ForbiddenError();
  }

  async function accountInWorkspace(accountId: string, workspaceId: string) {
    if (!UUID.test(accountId)) throw new NotFoundError();
    const [row] = await db
      .select({ id: socialAccounts.id })
      .from(socialAccounts)
      .innerJoin(
        providerConnections,
        eq(socialAccounts.connectionId, providerConnections.id),
      )
      .where(
        and(
          eq(socialAccounts.id, accountId),
          eq(providerConnections.workspaceId, workspaceId),
        ),
      );
    if (!row) throw new NotFoundError();
  }

  async function publishOne(post: typeof posts.$inferSelect) {
    try {
      const [target] = await db
        .select({
          provider: providerConnections.provider,
          enc: providerConnections.credentialsEnc,
          platform: socialAccounts.platform,
          externalId: socialAccounts.externalId,
        })
        .from(socialAccounts)
        .innerJoin(
          providerConnections,
          eq(socialAccounts.connectionId, providerConnections.id),
        )
        .where(eq(socialAccounts.id, post.socialAccountId));
      if (!target) return fail(post.id, "account_missing");
      let credentials: string;
      try {
        credentials = box.decrypt(target.enc);
      } catch {
        return fail(post.id, "credentials_unreadable");
      }
      const provider = resolveProvider(target.provider, credentials);
      if (!provider) return fail(post.id, "provider_unavailable");
      const result = await publishViaProvider(
        provider,
        {
          platform: target.platform as Platform,
          accountId: target.externalId,
          text: post.text,
        },
        { now },
      );
      await db
        .update(posts)
        .set({
          status: "published",
          externalId: result.id,
          publishedAt: now(),
          errorCode: null,
        })
        .where(eq(posts.id, post.id));
      return true;
    } catch (e) {
      return fail(post.id, errorCodeOf(e));
    }
  }

  async function fail(id: string, code: string) {
    await db
      .update(posts)
      .set({ status: "failed", errorCode: code })
      .where(eq(posts.id, id));
    return false;
  }

  return {
    async schedule(input: {
      actorId: string;
      workspaceId: string;
      accountId: string;
      text: string;
      scheduledAt?: string;
      idempotencyKey: string;
    }): Promise<PostView> {
      await requireMember(input.actorId, input.workspaceId, "posts.publish");
      if (
        input.idempotencyKey.length === 0 ||
        input.idempotencyKey.length > MAX_KEY
      )
        throw new ValidationError(
          `Khoá idempotency phải dài 1-${MAX_KEY} ký tự`,
        );
      const text = input.text.normalize("NFC").trim();
      if (text === "")
        throw new ValidationError("Nội dung bài đăng không được rỗng");
      const current = now();
      let at = current;
      if (input.scheduledAt !== undefined) {
        const ms = parseIsoWithOffset(input.scheduledAt);
        if (ms === undefined)
          throw new ValidationError(
            "Giờ hẹn phải là ISO 8601 đầy đủ kèm múi giờ",
          );
        if (ms <= current.getTime())
          throw new ValidationError("Giờ hẹn phải ở tương lai");
        at = new Date(ms);
      }
      await accountInWorkspace(input.accountId, input.workspaceId);

      const [created] = await db
        .insert(posts)
        .values({
          workspaceId: input.workspaceId,
          socialAccountId: input.accountId,
          createdBy: input.actorId,
          text,
          status: "scheduled",
          scheduledAt: at,
          idempotencyKey: input.idempotencyKey,
        })
        .onConflictDoNothing({
          target: [posts.workspaceId, posts.idempotencyKey],
        })
        .returning();
      if (created) return view(created);

      // Gửi lại cùng khoá: trả bài cũ nếu cùng nội dung và tài khoản, không thì xung đột.
      const [existing] = await db
        .select()
        .from(posts)
        .where(
          and(
            eq(posts.workspaceId, input.workspaceId),
            eq(posts.idempotencyKey, input.idempotencyKey),
          ),
        );
      if (
        !existing ||
        existing.text !== text ||
        existing.socialAccountId !== input.accountId
      ) {
        throw new ConflictError(
          "idempotency_conflict",
          "Khoá idempotency đã dùng cho yêu cầu khác",
        );
      }
      return view(existing);
    },

    /** Nhận bài đến hạn (SKIP LOCKED: nhiều worker không nhận trùng) rồi đăng từng bài. */
    async runDue({ limit }: { limit: number }) {
      const claimed = await db.transaction(async (tx) => {
        const ids = await tx
          .select({ id: posts.id })
          .from(posts)
          .where(
            and(eq(posts.status, "scheduled"), lte(posts.scheduledAt, now())),
          )
          .orderBy(asc(posts.scheduledAt), asc(posts.createdAt))
          .limit(limit)
          .for("update", { skipLocked: true });
        if (ids.length === 0) return [];
        return tx
          .update(posts)
          .set({
            status: "publishing",
            attempts: sql`${posts.attempts} + 1`,
            claimedAt: now(),
          })
          .where(
            inArray(
              posts.id,
              ids.map((r) => r.id),
            ),
          )
          .returning();
      });
      claimed.sort(
        (a, b) =>
          a.scheduledAt.getTime() - b.scheduledAt.getTime() ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      );
      let published = 0;
      let failed = 0;
      for (const post of claimed) {
        if (await publishOne(post)) published++;
        else failed++;
      }
      return { published, failed };
    },

    /** Bài kẹt `publishing` (worker chết giữa chừng) → failed, KHÔNG tự đăng lại vì có thể đã lên mạng. */
    async recoverStuck({ olderThanMs }: { olderThanMs: number }) {
      const cutoff = new Date(now().getTime() - olderThanMs);
      const rows = await db
        .update(posts)
        .set({ status: "failed", errorCode: "interrupted" })
        .where(
          and(eq(posts.status, "publishing"), lte(posts.claimedAt, cutoff)),
        )
        .returning({ id: posts.id });
      return rows.length;
    },

    async list(input: {
      actorId: string;
      workspaceId: string;
    }): Promise<PostView[]> {
      await requireMember(input.actorId, input.workspaceId, "inbox.read");
      const rows = await db
        .select()
        .from(posts)
        .where(eq(posts.workspaceId, input.workspaceId))
        .orderBy(asc(posts.scheduledAt));
      return rows.map(view);
    },
  };
}

export type PostService = ReturnType<typeof createPostService>;
