import { PgBoss } from "pg-boss";

import type { JobQueue } from "./runner";

/** Bọc pg-boss thành cổng `JobQueue`; mỗi lô job chạy lần lượt, job lỗi làm cả lô thử lại. */
export function pgBossQueue(
  boss: PgBoss,
  opts: { pollingIntervalSeconds?: number } = {},
): JobQueue {
  return {
    // `createQueue` của pg-boss là INSERT … ON CONFLICT DO NOTHING: hàng đợi đã có (tạo ở bản cũ, không kèm tuỳ chọn)
    // giữ nguyên cấu hình cũ, nên nâng cấp không nhận retry/hàng chết mới (AUD-CODE-009). `updateQueue` áp lại tuỳ
    // chọn cho hàng đợi đã tồn tại; lũy đẳng, chạy mỗi lần khởi động.
    createQueue: async (name, options) => {
      await boss.createQueue(name, options);
      if (options) await boss.updateQueue(name, options);
    },
    schedule: (name, cron) => boss.schedule(name, cron),
    work: async (name, handler) => {
      await boss.work(
        name,
        { pollingIntervalSeconds: opts.pollingIntervalSeconds ?? 5 },
        async (jobs) => {
          for (const job of jobs) await handler(job.data);
        },
      );
    },
    send: async (name, data, options) => {
      await boss.send(name, data, options);
    },
  };
}

/** Khởi động pg-boss trên chính Postgres của app (schema riêng `pgboss`, tự tạo/migrate). */
export async function startBoss(databaseUrl: string) {
  const boss = new PgBoss({
    connectionString: databaseUrl,
    // Timeout tường minh như mọi lời gọi CSDL khác (BASE-ERR-004).
    connectionTimeoutMillis: 5_000,
    max: 5,
  });
  boss.on("error", () => {
    // Lỗi nền của pg-boss được ghi qua log của runner khi job ném; ở đây chỉ chặn sự kiện không có
    // listener làm sập tiến trình.
  });
  await boss.start();
  return boss;
}
