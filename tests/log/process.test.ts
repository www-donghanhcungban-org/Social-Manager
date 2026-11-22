import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { createLogger } from "@/src/log/logger";
import { installProcessHandlers } from "@/src/log/process";

function fakeProcess() {
  const handlers: Record<string, (arg: unknown) => void> = {};
  return {
    handlers,
    on: vi.fn((ev: string, fn: (arg: unknown) => void) => {
      handlers[ev] = fn;
      return undefined as never;
    }),
    exit: vi.fn() as unknown as (code?: number) => never,
  };
}

describe("installProcessHandlers (BASE-ERR-002)", () => {
  it("unhandledRejection: ghi log error, không thoát", () => {
    const p = fakeProcess();
    const lines: string[] = [];
    const log = createLogger({
      service: "t",
      version: "0",
      env: "test",
      write: (l) => lines.push(l),
    });
    installProcessHandlers(p as never, log);
    p.handlers.unhandledRejection!(new Error("hỏng"));
    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: "error",
      "exception.message": "hỏng",
    });
    expect(p.exit).not.toHaveBeenCalled();
  });

  it("uncaughtException: ghi log fatal rồi thoát mã 1", () => {
    const p = fakeProcess();
    const lines: string[] = [];
    const log = createLogger({
      service: "t",
      version: "0",
      env: "test",
      write: (l) => lines.push(l),
    });
    installProcessHandlers(p as never, log);
    p.handlers.uncaughtException!(new TypeError("nặng"));
    expect(JSON.parse(lines[0]!).level).toBe("fatal");
    expect(p.exit).toHaveBeenCalledWith(1);
  });
});

describe("biên lỗi giao diện không lộ chi tiết (BASE-ERR-003)", () => {
  it.each(["app/error.tsx", "app/global-error.tsx"])(
    "%s chỉ dùng digest, không đọc message/stack",
    (file) => {
      const src = readFileSync(file, "utf-8");
      expect(src).toContain("error.digest");
      expect(src).not.toMatch(/error\.(message|stack)/);
    },
  );
});
