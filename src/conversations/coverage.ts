import { and, count, eq, isNotNull, sql } from "drizzle-orm";

import { requireAction } from "../auth/access";
import type { Db } from "../auth/members";
import {
  conversations,
  providerConnections,
  socialAccounts,
  sourceCheckpoints,
} from "../db/schema";

const SAFE_CODE = /^[A-Za-z0-9_.-]{1,64}$/;

export interface CoverageRow {
  socialAccountId: string;
  displayName: string;
  platform: string;
  /** Chưa có lượt đồng bộ nào chạy xong (kể cả lỗi). */
  neverRun: boolean;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  consecutiveFailures: number;
  lastErrorCode: string | null;
  /** Số hội thoại còn lịch sử cũ chưa lấy hết (đang đọc dần qua nhiều lượt). */
  conversationsWithBackfill: number;
}

/**
 * Độ bao phủ nguồn: tài khoản nào đã đồng bộ tới đâu, lỗi gì, còn lịch sử nào chưa lấy. Để người dùng không nhầm
 * "không có tin mới" với "chưa đồng bộ được".
 */
export function createCoverageService({
  db,
  now = () => new Date(),
}: {
  db: Db;
  now?: () => Date;
}) {
  return {
    /**
     * Ghi kết quả một lượt đồng bộ (chỉ cho mã server). `errorCode` chỉ nhận mã ngắn an toàn: chuỗi lạ bị thay bằng
     * `upstream_error` để không lưu nội dung lỗi của nhà cung cấp.
     */
    async record(input: {
      workspaceId: string;
      socialAccountId: string;
      ok: boolean;
      errorCode?: string;
    }): Promise<void> {
      const at = now();
      const code = input.ok
        ? null
        : SAFE_CODE.test(input.errorCode ?? "")
          ? input.errorCode!
          : "upstream_error";
      await db
        .insert(sourceCheckpoints)
        .values({
          workspaceId: input.workspaceId,
          socialAccountId: input.socialAccountId,
          lastRunAt: at,
          lastSuccessAt: input.ok ? at : null,
          consecutiveFailures: input.ok ? 0 : 1,
          lastErrorCode: code,
        })
        .onConflictDoUpdate({
          target: sourceCheckpoints.socialAccountId,
          set: {
            lastRunAt: at,
            lastSuccessAt: input.ok
              ? at
              : sql`${sourceCheckpoints.lastSuccessAt}`,
            consecutiveFailures: input.ok
              ? 0
              : sql`${sourceCheckpoints.consecutiveFailures} + 1`,
            lastErrorCode: code,
          },
        });
    },

    async report(input: {
      actorId: string;
      workspaceId: string;
    }): Promise<CoverageRow[]> {
      await requireAction(db, input.actorId, input.workspaceId, "inbox.read");
      const accounts = await db
        .select({
          id: socialAccounts.id,
          displayName: socialAccounts.displayName,
          platform: socialAccounts.platform,
          lastRunAt: sourceCheckpoints.lastRunAt,
          lastSuccessAt: sourceCheckpoints.lastSuccessAt,
          consecutiveFailures: sourceCheckpoints.consecutiveFailures,
          lastErrorCode: sourceCheckpoints.lastErrorCode,
        })
        .from(socialAccounts)
        .innerJoin(
          providerConnections,
          eq(socialAccounts.connectionId, providerConnections.id),
        )
        .leftJoin(
          sourceCheckpoints,
          eq(sourceCheckpoints.socialAccountId, socialAccounts.id),
        )
        .where(eq(providerConnections.workspaceId, input.workspaceId))
        .orderBy(socialAccounts.displayName, socialAccounts.id);
      const pending = await db
        .select({
          accountId: conversations.socialAccountId,
          n: count(),
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.workspaceId, input.workspaceId),
            isNotNull(conversations.backfillCursor),
          ),
        )
        .groupBy(conversations.socialAccountId);
      const byAccount = new Map(pending.map((p) => [p.accountId, p.n]));
      return accounts.map((a) => ({
        socialAccountId: a.id,
        displayName: a.displayName,
        platform: a.platform,
        neverRun: a.lastRunAt === null,
        lastRunAt: a.lastRunAt,
        lastSuccessAt: a.lastSuccessAt,
        consecutiveFailures: a.consecutiveFailures ?? 0,
        lastErrorCode: a.lastErrorCode,
        conversationsWithBackfill: byAccount.get(a.id) ?? 0,
      }));
    },
  };
}

export type CoverageService = ReturnType<typeof createCoverageService>;
