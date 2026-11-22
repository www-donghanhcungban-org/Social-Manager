import { and, eq, inArray, lt, notExists, sql } from "drizzle-orm";

import type { Db } from "../auth/members";
import {
  conversations,
  inboxItems,
  loginThrottle,
  messages,
  session,
  verification,
  workspaces,
} from "../db/schema";

const DAY_MS = 86_400_000;
export const DEFAULT_INBOX_DAYS = 365;
const DEFAULT_BATCH = 5000;
/** Phiên/mã xác minh hết hạn được giữ thêm chừng này trước khi xoá (tránh xoá sát lúc đang dùng). */
const AUTH_GRACE_MS = DAY_MS;
const THROTTLE_STALE_MS = DAY_MS;

export interface PurgeResult {
  inboxItems: number;
  messages: number;
  conversations: number;
  /** Blob bằng chứng mồ côi đã xoá (cùng tệp nếu không nơi nào khác dùng). */
  evidenceBlobs: number;
  sessions: number;
  verifications: number;
  loginThrottle: number;
  /** Còn tin quá hạn chưa xoá hết (đã chạm trần lô); lần chạy sau xoá tiếp. */
  more: boolean;
}

/**
 * Thực thi thời hạn lưu dữ liệu (PROJECT.md §5): tin hộp thư/tin nhắn quá hạn của từng workspace (mặc định 365 ngày,
 * owner đổi được hoặc giữ vô thời hạn — D-010), phiên và mã xác minh hết hạn,
 * bộ đếm đăng nhập cũ. Xoá theo lô để không giữ khoá bảng lâu; chạy lại an toàn (lũy đẳng).
 *
 * Lưu ý: nếu nhà cung cấp vẫn trả lại tin cũ hơn hạn khi đồng bộ, tin đó sẽ được nhập lại rồi bị xoá ở
 * lần dọn sau; đồng bộ chỉ hỏi tin gần đây nên hiếm gặp.
 */
export function createRetentionService({
  db,
  evidence,
}: {
  db: Db;
  /**
   * Có thì sau khi xoá tin (bản sao bằng chứng của chúng đã tự xoá theo khoá ngoại), dọn blob không còn lần xuất hiện nào
   * và tệp của nó: nội dung tin không được sống lâu hơn hạn lưu (H5).
   */
  evidence?: {
    sweepOrphanBlobs(input?: {
      limit?: number;
    }): Promise<{ blobs: number; files: number }>;
  };
}) {
  return {
    async purgeExpired({
      now = new Date(),
      inboxDays = DEFAULT_INBOX_DAYS,
      batchSize = DEFAULT_BATCH,
    }: {
      now?: Date;
      inboxDays?: number;
      batchSize?: number;
    } = {}): Promise<PurgeResult> {
      if (!Number.isInteger(inboxDays) || inboxDays < 1)
        throw new Error("inboxDays phải là số nguyên dương");
      if (!Number.isInteger(batchSize) || batchSize < 1)
        throw new Error("batchSize phải là số nguyên dương");

      // Hạn tính theo từng workspace (D-010): số ngày riêng hoặc mặc định; workspace giữ vô thời hạn thì bỏ qua.
      const cutoff = sql`(${now.toISOString()}::timestamptz - make_interval(days => coalesce(${workspaces.inboxRetentionDays}, ${inboxDays}::int)))`;
      const purgeable = eq(workspaces.retainInboxForever, false);
      const ids = await db
        .select({ id: inboxItems.id })
        .from(inboxItems)
        .innerJoin(workspaces, eq(workspaces.id, inboxItems.workspaceId))
        .where(and(purgeable, sql`${inboxItems.receivedAt} < ${cutoff}`))
        .orderBy(inboxItems.receivedAt)
        .limit(batchSize + 1);
      const batch = ids.slice(0, batchSize).map((r) => r.id);
      const deletedInbox =
        batch.length === 0
          ? []
          : await db
              .delete(inboxItems)
              .where(inArray(inboxItems.id, batch))
              .returning({ id: inboxItems.id });

      const authCutoff = new Date(now.getTime() - AUTH_GRACE_MS);
      const sessions = await db
        .delete(session)
        .where(lt(session.expiresAt, authCutoff))
        .returning({ id: session.id });
      const verifications = await db
        .delete(verification)
        .where(lt(verification.expiresAt, authCutoff))
        .returning({ id: verification.id });
      const throttles = await db
        .delete(loginThrottle)
        .where(
          lt(
            loginThrottle.updatedAt,
            new Date(now.getTime() - THROTTLE_STALE_MS),
          ),
        )
        .returning({ key: loginThrottle.keyHash });

      // Tin nhắn theo hội thoại (ADR-0002): cùng hạn, tính từ lúc tin được gửi.
      const msgIds = await db
        .select({ id: messages.id })
        .from(messages)
        .innerJoin(workspaces, eq(workspaces.id, messages.workspaceId))
        .where(and(purgeable, sql`${messages.sentAt} < ${cutoff}`))
        .orderBy(messages.sentAt)
        .limit(batchSize + 1);
      const msgBatch = msgIds.slice(0, batchSize).map((r) => r.id);
      const deletedMessages =
        msgBatch.length === 0
          ? []
          : await db
              .delete(messages)
              .where(inArray(messages.id, msgBatch))
              .returning({ id: messages.id });
      // Hội thoại (giữ tên/id người nhắn) hết tin còn hạn thì xoá luôn; còn tin mới hơn hạn thì giữ.
      const convIds = await db
        .select({ id: conversations.id })
        .from(conversations)
        .innerJoin(workspaces, eq(workspaces.id, conversations.workspaceId))
        .where(
          and(
            purgeable,
            sql`coalesce(${conversations.lastMessageAt}, ${conversations.createdAt}) < ${cutoff}`,
            notExists(
              db
                .select({ one: sql`1` })
                .from(messages)
                .where(
                  and(
                    eq(messages.conversationId, conversations.id),
                    sql`${messages.sentAt} >= ${cutoff}`,
                  ),
                ),
            ),
          ),
        )
        .limit(batchSize);
      const deletedConversations =
        convIds.length === 0
          ? []
          : await db
              .delete(conversations)
              .where(
                inArray(
                  conversations.id,
                  convIds.map((r) => r.id),
                ),
              )
              .returning({ id: conversations.id });

      const swept = evidence
        ? await evidence.sweepOrphanBlobs({ limit: batchSize })
        : { blobs: 0, files: 0 };

      return {
        evidenceBlobs: swept.blobs,
        inboxItems: deletedInbox.length,
        messages: deletedMessages.length,
        conversations: deletedConversations.length,
        sessions: sessions.length,
        verifications: verifications.length,
        loginThrottle: throttles.length,
        more: ids.length > batchSize || msgIds.length > batchSize,
      };
    },
  };
}
