import type { Env } from "../config/env";
import { createContainer } from "../server/container";
import { defaultLogger } from "../log/process";
import { pgBossQueue, startBoss } from "./pgboss";
import { createJobRunner } from "./runner";

/**
 * Chạy worker nền trong tiến trình server. Trả về hàm dừng êm (đợi job đang chạy), hoặc `undefined`
 * khi `RUN_WORKERS=false`.
 */
export async function startWorkers(
  cfg: Env,
): Promise<(() => Promise<void>) | undefined> {
  if (cfg.RUN_WORKERS === "false") return undefined;
  const log = defaultLogger();
  const container = createContainer(cfg);
  const boss = await startBoss(cfg.DATABASE_URL);
  const runner = createJobRunner({
    queue: pgBossQueue(boss),
    posts: container.services.posts,
    inbox: container.services.inbox,
    retention: container.services.retention,
    listAccounts: container.listAccounts,
    log,
  });
  await runner.start();
  log.info("worker nền đã chạy", { queues: "posts, inbox, maintenance" });
  return async () => {
    await boss.stop({ graceful: true, timeout: 20_000 });
    await container.close();
  };
}
