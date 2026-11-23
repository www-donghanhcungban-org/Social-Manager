import { describe, expect, it, vi } from "vitest";

import { createJobRunner, QUEUES, type JobQueue } from "@/src/jobs/runner";
import { createLogger } from "@/src/log/logger";

function fakeQueue() {
  const handlers = new Map<string, (data: unknown) => Promise<void>>();
  const q: JobQueue & {
    created: string[];
    schedules: Record<string, string>;
    sent: { name: string; data: unknown; key?: string }[];
    run: (name: string, data?: unknown) => Promise<void>;
  } = {
    created: [],
    schedules: {},
    sent: [],
    createQueue: async (n) => void q.created.push(n),
    schedule: async (n, cron) => void (q.schedules[n] = cron),
    work: async (n, h) => void handlers.set(n, h),
    send: async (name, data, opts) =>
      void q.sent.push({ name, data, key: opts?.singletonKey }),
    run: async (n, d) => {
      const h = handlers.get(n);
      if (!h) throw new Error(`chưa đăng ký worker ${n}`);
      await h(d);
    },
  };
  return q;
}

function setup() {
  const q = fakeQueue();
  const lines: string[] = [];
  const posts = {
    runDue: vi.fn<
      (i: { limit: number }) => Promise<{ published: number; failed: number }>
    >(async () => ({ published: 2, failed: 1 })),
    recoverStuck: vi.fn<(i: { olderThanMs: number }) => Promise<number>>(
      async () => 3,
    ),
    confirmSubmitted: vi.fn<
      (i: {
        limit: number;
        deadlineMs: number;
      }) => Promise<Record<string, number>>
    >(async () => ({ published: 1, pending: 2 })),
  };
  const inbox = {
    syncAsSystem: vi.fn<
      (i: { workspaceId: string; accountId: string }) => Promise<{
        inserted: number;
      }>
    >(async () => ({ inserted: 4 })),
  };
  const retention = {
    purgeExpired: vi.fn(async () => ({
      inboxItems: 2,
      messages: 0,
      conversations: 0,
      evidenceBlobs: 0,
      sessions: 1,
      verifications: 0,
      loginThrottle: 0,
      more: false,
    })),
  };
  const actions = {
    dispatchDue: vi.fn<
      (i: { limit: number }) => Promise<Record<string, number>>
    >(async () => ({ sent: 1, blocked: 0 })),
    reconcileDue: vi.fn<
      (i: {
        limit: number;
        minAgeMs: number;
        maxAgeMs: number;
      }) => Promise<Record<string, number>>
    >(async () => ({ confirmed: 1, not_found: 2 })),
    recoverStuck: vi.fn<(i: { olderThanMs: number }) => Promise<number>>(
      async () => 2,
    ),
  };
  const log = createLogger({
    service: "t",
    version: "0",
    env: "test",
    write: (l) => lines.push(l),
  });
  const runner = createJobRunner({
    queue: q,
    posts,
    actions,
    inbox,
    retention,
    listAccounts: async () => [
      { workspaceId: "w1", accountId: "a1" },
      { workspaceId: "w1", accountId: "a2" },
    ],
    log,
  });
  return { q, posts, actions, inbox, retention, runner, lines };
}

describe("createJobRunner", () => {
  it("start tạo hàng đợi, đặt lịch và đăng ký worker cho mọi loại việc", async () => {
    const { q, runner } = setup();
    await runner.start();
    expect([...q.created].sort()).toEqual(Object.values(QUEUES).sort());
    expect(q.schedules).toEqual({
      [QUEUES.runDue]: "* * * * *",
      [QUEUES.recoverStuck]: "*/5 * * * *",
      [QUEUES.confirmSubmitted]: "*/2 * * * *",
      [QUEUES.syncAll]: "*/5 * * * *",
      [QUEUES.purgeExpired]: "17 3 * * *",
      [QUEUES.actionsDispatch]: "* * * * *",
      [QUEUES.actionsReconcile]: "*/2 * * * *",
      [QUEUES.actionsRecoverStuck]: "*/5 * * * *",
    });
  });

  it("job purgeExpired lặp theo lô tới khi hết, cộng dồn kết quả và ghi log", async () => {
    const { q, runner, retention, lines } = setup();
    retention.purgeExpired
      .mockResolvedValueOnce({
        inboxItems: 5000,
        messages: 0,
        conversations: 0,
        evidenceBlobs: 0,
        sessions: 1,
        verifications: 0,
        loginThrottle: 0,
        more: true,
      })
      .mockResolvedValueOnce({
        inboxItems: 7,
        messages: 0,
        conversations: 0,
        evidenceBlobs: 0,
        sessions: 0,
        verifications: 2,
        loginThrottle: 1,
        more: false,
      });
    await runner.start();
    await q.run(QUEUES.purgeExpired);
    expect(retention.purgeExpired).toHaveBeenCalledTimes(2);
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({
      level: "info",
      job: QUEUES.purgeExpired,
      inboxItems: 5007,
      expiredLogins: 1,
      verifications: 2,
      loginThrottle: 1,
      batches: 2,
    });
  });

  it("job purgeExpired có trần số lô, không lặp vô hạn khi luôn còn dữ liệu", async () => {
    const { q, runner, retention } = setup();
    retention.purgeExpired.mockResolvedValue({
      inboxItems: 1,
      messages: 0,
      conversations: 0,
      evidenceBlobs: 0,
      sessions: 0,
      verifications: 0,
      loginThrottle: 0,
      more: true,
    });
    await runner.start();
    await q.run(QUEUES.purgeExpired);
    expect(retention.purgeExpired).toHaveBeenCalledTimes(20);
  });

  it("job runDue gọi dịch vụ đăng bài và ghi log kết quả", async () => {
    const { q, runner, posts, lines } = setup();
    await runner.start();
    await q.run(QUEUES.runDue);
    expect(posts.runDue).toHaveBeenCalledWith({ limit: 20 });
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({
      level: "info",
      published: 2,
      failed: 1,
    });
  });

  it("job confirmSubmitted xác nhận theo lô với hạn 24 giờ và ghi log kết quả", async () => {
    const { q, runner, posts, lines } = setup();
    await runner.start();
    await q.run(QUEUES.confirmSubmitted);
    expect(posts.confirmSubmitted).toHaveBeenCalledWith({
      limit: 50,
      deadlineMs: 24 * 3_600_000,
    });
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({
      job: QUEUES.confirmSubmitted,
      published: 1,
      pending: 2,
    });
  });

  it("job actionsDispatch gửi theo lô có trần và ghi log kết quả", async () => {
    const { q, runner, actions, lines } = setup();
    await runner.start();
    await q.run(QUEUES.actionsDispatch);
    expect(actions.dispatchDue).toHaveBeenCalledWith({ limit: 20 });
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({
      job: QUEUES.actionsDispatch,
      sent: 1,
    });
  });

  it("job actionsReconcile đối soát send_unknown đủ 2 phút, bỏ khi quá 24 giờ", async () => {
    const { q, runner, actions } = setup();
    await runner.start();
    await q.run(QUEUES.actionsReconcile);
    expect(actions.reconcileDue).toHaveBeenCalledWith({
      limit: 20,
      minAgeMs: 120_000,
      maxAgeMs: 24 * 3_600_000,
    });
  });

  it("job gửi lỗi thì ném lại để hàng đợi thử lại, không nuốt lỗi", async () => {
    const { q, runner, actions } = setup();
    actions.dispatchDue.mockRejectedValueOnce(new Error("db down"));
    await runner.start();
    await expect(q.run(QUEUES.actionsDispatch)).rejects.toThrow("db down");
  });

  it("job actionsRecoverStuck gỡ hành động kẹt quá 10 phút và ghi log số dòng", async () => {
    const { q, runner, actions, lines } = setup();
    await runner.start();
    await q.run(QUEUES.actionsRecoverStuck);
    expect(QUEUES.actionsRecoverStuck).toBe("actions.recover-stuck");
    expect(actions.recoverStuck).toHaveBeenCalledWith({
      olderThanMs: 10 * 60_000,
    });
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({
      level: "info",
      job: QUEUES.actionsRecoverStuck,
      recovered: 2,
    });
  });

  it("job recoverStuck dùng ngưỡng 15 phút", async () => {
    const { q, runner, posts } = setup();
    await runner.start();
    await q.run(QUEUES.recoverStuck);
    expect(posts.recoverStuck).toHaveBeenCalledWith({
      olderThanMs: 15 * 60_000,
    });
  });

  it("syncAll rải mỗi tài khoản thành một job riêng, chống trùng bằng singletonKey", async () => {
    const { q, runner } = setup();
    await runner.start();
    await q.run(QUEUES.syncAll);
    expect(q.sent).toEqual([
      {
        name: QUEUES.syncAccount,
        data: { workspaceId: "w1", accountId: "a1" },
        key: "a1",
      },
      {
        name: QUEUES.syncAccount,
        data: { workspaceId: "w1", accountId: "a2" },
        key: "a2",
      },
    ]);
  });

  it("syncAccount gọi syncAsSystem đúng tài khoản; dữ liệu job sai bị từ chối, không gọi dịch vụ", async () => {
    const { q, runner, inbox } = setup();
    await runner.start();
    await q.run(QUEUES.syncAccount, { workspaceId: "w1", accountId: "a1" });
    expect(inbox.syncAsSystem).toHaveBeenCalledWith({
      workspaceId: "w1",
      accountId: "a1",
    });
    for (const bad of [
      undefined,
      null,
      {},
      { workspaceId: 1, accountId: "a" },
    ]) {
      await expect(q.run(QUEUES.syncAccount, bad)).rejects.toThrow(
        /dữ liệu job/,
      );
    }
    expect(inbox.syncAsSystem).toHaveBeenCalledTimes(1);
  });

  it("lỗi trong job được ghi log (không lộ bí mật) rồi ném lại để hàng đợi tự thử lại", async () => {
    const { q, runner, posts, lines } = setup();
    posts.runDue.mockRejectedValueOnce(
      new Error("kết nối postgres://u:pw@h/db hỏng"),
    );
    await runner.start();
    await expect(q.run(QUEUES.runDue)).rejects.toThrow();
    expect(JSON.parse(lines.at(-1)!).level).toBe("error");
    expect(lines.at(-1)).not.toContain("pw@");
  });

  it("start gọi hai lần không đăng ký trùng", async () => {
    const { q, runner } = setup();
    await runner.start();
    await runner.start();
    expect(q.created).toHaveLength(Object.keys(QUEUES).length);
  });
});
