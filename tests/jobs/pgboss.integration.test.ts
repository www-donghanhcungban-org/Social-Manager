import { randomBytes } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { pgBossQueue, startBoss } from "@/src/jobs/pgboss";
import { createJobRunner, QUEUES } from "@/src/jobs/runner";
import { createLogger } from "@/src/log/logger";

// Cần Postgres thật: đặt TEST_DATABASE_URL (kết nối tới một server, test tự tạo/xoá DB riêng).
// Không đặt thì bỏ qua cục bộ. Ở CI, job `gate` cấp service Postgres và biến này
// (tests/config/ci-postgres.test.ts giữ điều đó), nên test không bị skip ngầm.
const ADMIN_URL = process.env.TEST_DATABASE_URL;
const d = ADMIN_URL ? describe : describe.skip;
const noActions = {
  dispatchDue: async () => ({}),
  reconcileDue: async () => ({}),
  recoverStuck: async () => 0,
};
const noRetention = {
  purgeExpired: async () => ({
    inboxItems: 0,
    messages: 0,
    conversations: 0,
    evidenceBlobs: 0,
    sessions: 0,
    verifications: 0,
    loginThrottle: 0,
    more: false,
  }),
};

d("pg-boss trên Postgres thật", () => {
  const dbName = `sm_boss_${randomBytes(4).toString("hex")}`;
  let url: string;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    await admin.end();
    const u = new URL(ADMIN_URL!);
    u.pathname = `/${dbName}`;
    url = u.toString();
  });

  afterAll(async () => {
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  });

  it("job syncAccount đi qua hàng đợi thật tới dịch vụ, đúng dữ liệu, đúng một lần", async () => {
    const boss = await startBoss(url);
    try {
      const syncAsSystem = vi.fn(async () => ({ inserted: 1 }));
      const runner = createJobRunner({
        queue: pgBossQueue(boss, { pollingIntervalSeconds: 0.5 }),
        posts: {
          runDue: async () => ({ published: 0, failed: 0 }),
          recoverStuck: async () => 0,
          confirmSubmitted: async () => ({}),
        },
        actions: noActions,
        inbox: { syncAsSystem },
        retention: noRetention,
        listAccounts: async () => [],
        log: createLogger({
          service: "t",
          version: "0",
          env: "test",
          write: () => {},
        }),
      });
      await runner.start();
      await boss.send(
        QUEUES.syncAccount,
        { workspaceId: "w1", accountId: "a1" },
        { singletonKey: "a1" },
      );
      await vi.waitFor(() => expect(syncAsSystem).toHaveBeenCalledTimes(1), {
        timeout: 15_000,
        interval: 200,
      });
      expect(syncAsSystem).toHaveBeenCalledWith({
        workspaceId: "w1",
        accountId: "a1",
      });
    } finally {
      await boss.stop({ graceful: false, timeout: 2000 });
    }
  }, 30_000);

  it("lịch được đăng ký trong DB cho cả tám việc định kỳ", async () => {
    const boss = await startBoss(url);
    try {
      const runner = createJobRunner({
        queue: pgBossQueue(boss),
        posts: {
          runDue: async () => ({ published: 0, failed: 0 }),
          recoverStuck: async () => 0,
          confirmSubmitted: async () => ({}),
        },
        actions: noActions,
        inbox: { syncAsSystem: async () => ({ inserted: 0 }) },
        retention: noRetention,
        listAccounts: async () => [],
        log: createLogger({
          service: "t",
          version: "0",
          env: "test",
          write: () => {},
        }),
      });
      await runner.start();
      const names = (await boss.getSchedules()).map((s) => s.name).sort();
      expect(names).toEqual(
        [
          QUEUES.runDue,
          QUEUES.recoverStuck,
          QUEUES.confirmSubmitted,
          QUEUES.syncAll,
          QUEUES.purgeExpired,
          QUEUES.actionsDispatch,
          QUEUES.actionsReconcile,
          QUEUES.actionsRecoverStuck,
        ].sort(),
      );
    } finally {
      await boss.stop({ graceful: false, timeout: 2000 });
    }
  }, 30_000);
});
