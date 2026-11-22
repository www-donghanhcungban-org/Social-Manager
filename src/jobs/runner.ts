import type { Logger } from "../log/logger";

/** Tên hàng đợi; đổi tên = việc cũ trong hàng đợi mồ côi, nên coi như hợp đồng. */
export const QUEUES = {
  runDue: "posts.run-due",
  recoverStuck: "posts.recover-stuck",
  syncAll: "inbox.sync-all",
  syncAccount: "inbox.sync-account",
} as const;

const RUN_DUE_LIMIT = 20;
const STUCK_AFTER_MS = 15 * 60_000;

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
  };
  inbox: {
    syncAsSystem(i: {
      workspaceId: string;
      accountId: string;
    }): Promise<{ inserted: number }>;
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
  inbox,
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

      await queue.schedule(QUEUES.runDue, "* * * * *");
      await queue.schedule(QUEUES.recoverStuck, "*/5 * * * *");
      await queue.schedule(QUEUES.syncAll, "*/5 * * * *");
    },
  };
}

export type JobRunner = ReturnType<typeof createJobRunner>;
