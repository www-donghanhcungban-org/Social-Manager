import type { Logger } from "../log/logger";

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
/** Bài gửi quá chừng này mà nhà cung cấp chưa báo kết quả cuối → send_unknown. */
export const CONFIRM_DEADLINE_MS = 24 * 3_600_000;

/** Cổng tối thiểu tới hàng đợi: adapter pg-boss thật và bản giả trong test cùng thoả. */
export interface JobQueue {
  createQueue(name: string): Promise<void>;
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

function parseSyncData(data: unknown): {
  workspaceId: string;
  accountId: string;
} {
  const d = data as { workspaceId?: unknown; accountId?: unknown } | null;
  if (
    typeof d?.workspaceId !== "string" ||
    typeof d.accountId !== "string" ||
    d.workspaceId === "" ||
    d.accountId === ""
  ) {
    throw new Error("dữ liệu job không hợp lệ");
  }
  return { workspaceId: d.workspaceId, accountId: d.accountId };
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

  /** Lỗi: ghi log (đã che bí mật) rồi ném lại để hàng đợi tự thử lại theo chính sách của nó. */
  const guarded =
    (name: string, fn: (data: unknown) => Promise<Record<string, unknown>>) =>
    async (data: unknown) => {
      try {
        log.info(`job ${name} xong`, { job: name, ...(await fn(data)) });
      } catch (error) {
        log.error(`job ${name} lỗi`, { job: name, error });
        throw error;
      }
    };

  return {
    async start() {
      if (started) return;
      started = true;
      for (const name of Object.values(QUEUES)) await queue.createQueue(name);

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
          inbox.syncAsSystem(parseSyncData(data)),
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

      await queue.schedule(QUEUES.purgeExpired, PURGE_CRON);
      await queue.schedule(QUEUES.actionsDispatch, "* * * * *");
      await queue.schedule(QUEUES.actionsReconcile, "*/2 * * * *");
      await queue.schedule(QUEUES.runDue, "* * * * *");
      await queue.schedule(QUEUES.recoverStuck, "*/5 * * * *");
      await queue.schedule(QUEUES.confirmSubmitted, "*/2 * * * *");
      await queue.schedule(QUEUES.syncAll, "*/5 * * * *");
    },
  };
}

export type JobRunner = ReturnType<typeof createJobRunner>;
