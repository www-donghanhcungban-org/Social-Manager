import type { Logger } from "../log/logger";
import {
  deadLetterRecord,
  DLQ_RETENTION_SECONDS,
  dlqName,
  isPermanentJobError,
  JOB_RETRY,
  parseSyncAccountPayload,
} from "./policy";

/** Tên hàng đợi; đổi tên = việc cũ trong hàng đợi mồ côi, nên coi như hợp đồng. */
export const QUEUES = {
  runDue: "posts.run-due",
  recoverStuck: "posts.recover-stuck",
  confirmSubmitted: "posts.confirm-submitted",
  syncAll: "inbox.sync-all",
  syncAccount: "inbox.sync-account",
  purgeExpired: "maintenance.purge-expired",
  actionsDispatch: "actions.dispatch",
  actionsReconcile: "actions.reconcile",
  actionsRecoverStuck: "actions.recover-stuck",
} as const;

/** Dọn dữ liệu quá hạn lưu mỗi ngày lúc 03:17 UTC (giờ ít người dùng, lệch khỏi phút tròn). */
const PURGE_CRON = "17 3 * * *";
/** Chặn vòng lặp xoá theo lô: tối đa chừng này lô mỗi lần chạy, phần còn lại để lần sau. */
const MAX_PURGE_BATCHES = 20;

const RUN_DUE_LIMIT = 20;
const STUCK_AFTER_MS = 15 * 60_000;
const CONFIRM_LIMIT = 50;
/** Trần lô gửi tin mỗi lần chạy: phần còn lại để lần sau, không dồn một lượt. */
export const DISPATCH_LIMIT = 20;
const RECONCILE_LIMIT = 20;
/** Đối soát send_unknown: chờ ít nhất chừng này kể từ lúc gửi/lần trước; quá hạn thì để người quyết. */
export const RECONCILE_MIN_AGE_MS = 2 * 60_000;
export const RECONCILE_MAX_AGE_MS = 24 * 3_600_000;
/**
 * Hành động gửi kẹt `dispatching`/`cancel_requested` quá chừng này → send_unknown. 10 phút ≫ hạn chờ HTTP của nhà cung cấp
 * (15 giây) nên không đụng việc đang gửi thật; đủ ngắn để nháp không bị khoá lâu, và nằm trong cửa sổ đối soát
 * [RECONCILE_MIN_AGE_MS, RECONCILE_MAX_AGE_MS] để đối soát tự động chạy tiếp được.
 */
export const ACTION_STUCK_AFTER_MS = 10 * 60_000;
/** Bài gửi quá chừng này mà nhà cung cấp chưa báo kết quả cuối → send_unknown. */
export const CONFIRM_DEADLINE_MS = 24 * 3_600_000;

/** Cổng tối thiểu tới hàng đợi: adapter pg-boss thật và bản giả trong test cùng thoả. */
export interface QueueOptions {
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  retryDelayMax?: number;
  /** Hàng chết nhận job hết lượt thử. */
  deadLetter?: string;
  retentionSeconds?: number;
}

export interface JobQueue {
  createQueue(name: string, options?: QueueOptions): Promise<void>;
  schedule(name: string, cron: string): Promise<void>;
  work(name: string, handler: (data: unknown) => Promise<void>): Promise<void>;
  send(
    name: string,
    data: object,
    options?: { singletonKey?: string },
  ): Promise<void>;
}

export interface JobRunnerDeps {
  queue: JobQueue;
  posts: {
    runDue(i: {
      limit: number;
    }): Promise<{ published: number; failed: number }>;
    recoverStuck(i: { olderThanMs: number }): Promise<number>;
    confirmSubmitted(i: {
      limit: number;
      deadlineMs: number;
    }): Promise<Record<string, number>>;
  };
  actions: {
    dispatchDue(i: { limit: number }): Promise<Record<string, number>>;
    reconcileDue(i: {
      limit: number;
      minAgeMs: number;
      maxAgeMs: number;
    }): Promise<Record<string, number>>;
    recoverStuck(i: { olderThanMs: number }): Promise<number>;
  };
  inbox: {
    syncAsSystem(i: {
      workspaceId: string;
      accountId: string;
    }): Promise<{ inserted: number }>;
  };
  retention: {
    purgeExpired(): Promise<{
      inboxItems: number;
      messages: number;
      conversations: number;
      evidenceBlobs: number;
      sessions: number;
      verifications: number;
      loginThrottle: number;
      more: boolean;
    }>;
  };
  listAccounts(): Promise<{ workspaceId: string; accountId: string }[]>;
  log: Logger;
}

export function createJobRunner({
  queue,
  posts,
  actions,
  inbox,
  retention,
  listAccounts,
  log,
}: JobRunnerDeps) {
  let started = false;

  /**
   * Lỗi: ghi log (đã che bí mật). Lỗi vĩnh viễn (dữ liệu job sai, 4xx nghiệp vụ) → bản ghi vào hàng chết ngay và KHÔNG
   * ném (thử lại vô ích, BE-JOB-003); lỗi tạm thời → ném lại để hàng đợi thử lại theo `JOB_RETRY`, hết lượt thì pg-boss
   * chuyển sang hàng chết.
   */
  const guarded =
    (name: string, fn: (data: unknown) => Promise<Record<string, unknown>>) =>
    async (data: unknown) => {
      try {
        log.info(`job ${name} xong`, { job: name, ...(await fn(data)) });
      } catch (error) {
        log.error(`job ${name} lỗi`, { job: name, error });
        if (isPermanentJobError(error)) {
          await queue.send(
            dlqName(name),
            deadLetterRecord({ queue: name, payload: data, error }),
          );
          return;
        }
        throw error;
      }
    };

  return {
    async start() {
      if (started) return;
      started = true;
      // Hàng chết phải có trước hàng gốc (pg-boss kiểm `deadLetter` tồn tại); giữ lâu hơn hàng gốc.
      for (const name of Object.values(QUEUES)) {
        await queue.createQueue(dlqName(name), {
          retentionSeconds: DLQ_RETENTION_SECONDS,
        });
        await queue.createQueue(name, {
          ...JOB_RETRY,
          deadLetter: dlqName(name),
        });
      }

      await queue.work(
        QUEUES.runDue,
        guarded(QUEUES.runDue, () => posts.runDue({ limit: RUN_DUE_LIMIT })),
      );
      await queue.work(
        QUEUES.recoverStuck,
        guarded(QUEUES.recoverStuck, async () => ({
          recovered: await posts.recoverStuck({ olderThanMs: STUCK_AFTER_MS }),
        })),
      );
      await queue.work(
        QUEUES.confirmSubmitted,
        guarded(QUEUES.confirmSubmitted, () =>
          posts.confirmSubmitted({
            limit: CONFIRM_LIMIT,
            deadlineMs: CONFIRM_DEADLINE_MS,
          }),
        ),
      );
      await queue.work(
        QUEUES.syncAll,
        guarded(QUEUES.syncAll, async () => {
          const accounts = await listAccounts();
          for (const a of accounts) {
            // singletonKey: tài khoản đang có việc chờ thì không xếp thêm, tránh dồn khi provider chậm.
            await queue.send(QUEUES.syncAccount, a, {
              singletonKey: a.accountId,
            });
          }
          return { enqueued: accounts.length };
        }),
      );
      await queue.work(
        QUEUES.syncAccount,
        guarded(QUEUES.syncAccount, (data) =>
          inbox.syncAsSystem(parseSyncAccountPayload(data)),
        ),
      );

      await queue.work(
        QUEUES.purgeExpired,
        guarded(QUEUES.purgeExpired, async () => {
          const total = {
            inboxItems: 0,
            messages: 0,
            conversations: 0,
            evidenceBlobs: 0,
            // Không đặt tên chứa "session": logger che các khóa trông như bí mật.
            expiredLogins: 0,
            verifications: 0,
            loginThrottle: 0,
            batches: 0,
          };
          for (let i = 0; i < MAX_PURGE_BATCHES; i++) {
            const r = await retention.purgeExpired();
            total.inboxItems += r.inboxItems;
            total.messages += r.messages;
            total.conversations += r.conversations;
            total.evidenceBlobs += r.evidenceBlobs;
            total.expiredLogins += r.sessions;
            total.verifications += r.verifications;
            total.loginThrottle += r.loginThrottle;
            total.batches++;
            if (!r.more) break;
          }
          return total;
        }),
      );

      // Cờ OUTBOUND_LIVE tắt: dispatchDue không đụng hành động nào (việc đã xếp hàng giữ nguyên). Lỗi ném lại để thử lại;
      // sổ hành động tự chống gửi trùng nên chạy lại an toàn.
      await queue.work(
        QUEUES.actionsDispatch,
        guarded(QUEUES.actionsDispatch, () =>
          actions.dispatchDue({ limit: DISPATCH_LIMIT }),
        ),
      );
      await queue.work(
        QUEUES.actionsReconcile,
        guarded(QUEUES.actionsReconcile, () =>
          actions.reconcileDue({
            limit: RECONCILE_LIMIT,
            minAgeMs: RECONCILE_MIN_AGE_MS,
            maxAgeMs: RECONCILE_MAX_AGE_MS,
          }),
        ),
      );
      // Gỡ hành động kẹt thành send_unknown (không gửi lại); đối soát/người quyết xử lý tiếp.
      await queue.work(
        QUEUES.actionsRecoverStuck,
        guarded(QUEUES.actionsRecoverStuck, async () => ({
          recovered: await actions.recoverStuck({
            olderThanMs: ACTION_STUCK_AFTER_MS,
          }),
        })),
      );

      await queue.schedule(QUEUES.purgeExpired, PURGE_CRON);
      await queue.schedule(QUEUES.actionsDispatch, "* * * * *");
      await queue.schedule(QUEUES.actionsReconcile, "*/2 * * * *");
      await queue.schedule(QUEUES.actionsRecoverStuck, "*/5 * * * *");
      await queue.schedule(QUEUES.runDue, "* * * * *");
      await queue.schedule(QUEUES.recoverStuck, "*/5 * * * *");
      await queue.schedule(QUEUES.confirmSubmitted, "*/2 * * * *");
      await queue.schedule(QUEUES.syncAll, "*/5 * * * *");
    },
  };
}

export type JobRunner = ReturnType<typeof createJobRunner>;
