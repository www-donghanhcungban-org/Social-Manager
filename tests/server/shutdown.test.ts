import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkHealth } from "@/src/http/health";
import {
  createShutdown,
  DEFAULT_GRACE_MS,
  HARD_EXIT_EXTRA_MS,
  isDraining,
  resetDrainingForTest,
} from "@/src/server/shutdown";

function setup(stopWorkers: () => Promise<void>) {
  const lines: string[] = [];
  const exit = vi.fn<(code: number) => void>();
  const log = {
    info: (m: string) => void lines.push(`info ${m}`),
    error: (m: string) => void lines.push(`error ${m}`),
  };
  return { s: createShutdown({ stopWorkers, log, exit }), lines, exit };
}

beforeEach(() => {
  resetDrainingForTest();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  resetDrainingForTest();
});

describe("tắt êm (ARC-RES-009, BE-REL-004)", () => {
  it("SIGTERM: readiness lỗi ngay, đợi worker dừng xong, KHÔNG gọi process.exit", async () => {
    let release!: () => void;
    const stopWorkers = vi.fn(
      () => new Promise<void>((r) => void (release = r)),
    );
    const { s, exit, lines } = setup(stopWorkers);
    expect(isDraining()).toBe(false);
    const done = s.trigger("SIGTERM");
    expect(isDraining()).toBe(true);
    // Đang tắt: health trả 503 mà không chạm CSDL.
    const ping = vi.fn(async () => {});
    const h = await checkHealth(ping, 2000, { draining: isDraining() });
    expect(h).toEqual({ status: 503, body: { status: "degraded" } });
    expect(ping).not.toHaveBeenCalled();
    // Job đang chạy: chưa xong thì promise chưa xong.
    let finished = false;
    void done.then(() => (finished = true));
    await vi.advanceTimersByTimeAsync(1000);
    expect(finished).toBe(false);
    release();
    await done;
    expect(finished).toBe(true);
    expect(stopWorkers).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
    expect(lines).toContain("info đã dừng worker nền và đóng kết nối");
  });

  it("gọi lần hai (SIGINT sau SIGTERM) không chạy lại việc dừng", async () => {
    const stopWorkers = vi.fn(async () => {});
    const { s } = setup(stopWorkers);
    await Promise.all([s.trigger("SIGTERM"), s.trigger("SIGINT")]);
    expect(stopWorkers).toHaveBeenCalledTimes(1);
  });

  it("worker treo: ngừng đợi sau hạn graceMs; quá hạn cứng thì thoát mã 1", async () => {
    const { s, exit, lines } = setup(() => new Promise<void>(() => {}));
    const done = s.trigger("SIGTERM");
    await vi.advanceTimersByTimeAsync(DEFAULT_GRACE_MS);
    await done;
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HARD_EXIT_EXTRA_MS);
    expect(exit).toHaveBeenCalledWith(1);
    expect(lines).toContain("error tắt êm quá hạn, thoát cưỡng bức");
  });

  it("lỗi khi dừng được ghi log, không ném ra ngoài", async () => {
    const { s, lines } = setup(async () => {
      throw new Error("đóng pool lỗi");
    });
    await expect(s.trigger("SIGTERM")).resolves.toBeUndefined();
    expect(lines).toContain("error lỗi khi tắt êm");
  });

  it("hạn tổng nhỏ hơn stop_grace_period của compose", async () => {
    const { readFileSync } = await import("node:fs");
    const m = /stop_grace_period:\s*(\d+)s/.exec(
      readFileSync("docker-compose.yml", "utf-8"),
    );
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(
      (DEFAULT_GRACE_MS + HARD_EXIT_EXTRA_MS) / 1000,
    );
  });
});
