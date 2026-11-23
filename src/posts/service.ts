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
import {
  getPostStatus as getRemoteStatus,
  parseIsoWithOffset,
  publishPost as publishViaProvider,
} from "../providers/actions";
import { SocialApiError } from "../providers/socialapi";
import {
  UnsupportedError,
  ValidationError,
  type Platform,
  type RemotePostStatus,
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

/**
 * Lỗi mà yêu cầu đăng CÓ THỂ đã tới nhà cung cấp (hết giờ, đứt kết nối, lỗi 5xx, phản hồi 2xx đọc không được):
 * không được coi là "chưa đăng", vì đăng lại có thể thành hai bài.
 */
function outcomeUnknown(e: unknown): boolean {
  if (!(e instanceof SocialApiError)) return false;
  if (e.code === "client.timeout" || e.code === "client.network") return true;
  if (e.status >= 500) return true;
  return (
    e.code === "client.invalid_response" && e.status >= 200 && e.status < 300
  );
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
      // Chỉ `published` mới là đã lên mạng; còn lại (submitted, hoặc nhà cung cấp tự giữ lịch) chờ xác nhận.
      const confirmed = result.status === "published";
      await db
        .update(posts)
        .set({
          status: confirmed ? "published" : "submitted",
          externalId: result.id,
          publishedAt: confirmed ? now() : null,
          errorCode: null,
        })
        .where(eq(posts.id, post.id));
      return true;
    } catch (e) {
      const code = errorCodeOf(e);
      return outcomeUnknown(e)
        ? mark(post.id, "send_unknown", code)
        : mark(post.id, "failed", code);
    }
  }

  const fail = (id: string, code: string) => mark(id, "failed", code);

  async function mark(
    id: string,
    status: "failed" | "send_unknown",
    code: string,
  ) {
    await db
      .update(posts)
      .set({ status, errorCode: code })
      .where(eq(posts.id, id));
    return false;
  }

  /** Thông tin để gọi lại nhà cung cấp cho một bài; null nếu không dựng được provider. */
  async function targetOf(post: typeof posts.$inferSelect) {
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
    if (!target) return null;
    try {
      const provider = resolveProvider(
        target.provider,
        box.decrypt(target.enc),
      );
      return provider ? { provider, target } : null;
    } catch {
      return null;
    }
  }

  /** Xác nhận một bài `submitted`; trả kết quả để đếm. */
  async function confirmOne(
    post: typeof posts.$inferSelect,
    deadline: Date,
  ): Promise<"published" | "partial" | "failed" | "pending" | "send_unknown"> {
    const overdue = (post.claimedAt ?? post.createdAt) <= deadline;
    let remote: RemotePostStatus | undefined;
    const t = post.externalId ? await targetOf(post) : null;
    if (t) {
      try {
        remote = await getRemoteStatus(t.provider, {
          platform: t.target.platform as Platform,
          accountId: t.target.externalId,
          postId: post.externalId!,
        });
      } catch {
        // Lỗi mạng/trạng thái lạ: giữ `submitted`, lượt sau hỏi lại (tới hạn thì thành send_unknown).
        remote = undefined;
      }
    }
    const set = (values: Partial<typeof posts.$inferInsert>) =>
      db
        .update(posts)
        .set(values)
        // Chỉ chuyển từ submitted: không ghi đè nếu tiến trình khác đã đổi.
        .where(and(eq(posts.id, post.id), eq(posts.status, "submitted")));
    if (remote === "published" || remote === "partial") {
      await set({ status: remote, publishedAt: now(), errorCode: null });
      return remote;
    }
    if (remote === "failed" || remote === "cancelled") {
      await set({
        status: "failed",
        errorCode: remote === "cancelled" ? "cancelled" : "upstream_failed",
      });
      return "failed";
    }
    if (overdue) {
      await set({ status: "send_unknown", errorCode: "confirm_timeout" });
      return "send_unknown";
    }
    return "pending";
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

    /**
     * Hỏi lại nhà cung cấp các bài `submitted` (cũ nhất trước). Quá `deadlineMs` kể từ lúc gửi mà vẫn chưa có kết quả
     * cuối → `send_unknown`; không bao giờ tự đăng lại.
     */
    async confirmSubmitted({
      limit,
      deadlineMs,
    }: {
      limit: number;
      deadlineMs: number;
    }) {
      const deadline = new Date(now().getTime() - deadlineMs);
      const rows = await db
        .select()
        .from(posts)
        .where(eq(posts.status, "submitted"))
        .orderBy(asc(posts.claimedAt))
        .limit(limit);
      const counts = {
        published: 0,
        partial: 0,
        failed: 0,
        pending: 0,
        send_unknown: 0,
      };
      for (const post of rows) counts[await confirmOne(post, deadline)]++;
      return counts;
    },

    /** Bài kẹt `publishing` (worker chết giữa chừng) → send_unknown, KHÔNG tự đăng lại vì có thể đã lên mạng. */
    async recoverStuck({ olderThanMs }: { olderThanMs: number }) {
      const cutoff = new Date(now().getTime() - olderThanMs);
      const rows = await db
        .update(posts)
        .set({ status: "send_unknown", errorCode: "interrupted" })
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
