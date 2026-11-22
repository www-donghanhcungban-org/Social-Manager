import { describe, expect, it } from "vitest";

import { createLogger } from "@/src/log/logger";

function setup() {
  const lines: string[] = [];
  const log = createLogger({
    service: "social-manager",
    version: "0.1.0",
    env: "test",
    write: (l) => lines.push(l),
    now: () => new Date("2026-11-22T03:04:05.678Z"),
  });
  const last = () =>
    JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
  return { log, lines, last };
}

describe("cấu trúc bản ghi (BASE-ERR-005/006)", () => {
  it("mỗi bản ghi là đúng một dòng JSON với trường tối thiểu", () => {
    const { log, lines, last } = setup();
    log.info("khởi động", { port: 3000 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("\n");
    expect(last()).toEqual({
      timestamp: "2026-11-22T03:04:05.678Z",
      level: "info",
      severity_number: 9,
      message: "khởi động",
      service: "social-manager",
      version: "0.1.0",
      env: "test",
      port: 3000,
    });
  });

  it.each([
    ["debug", 5],
    ["info", 9],
    ["warn", 13],
    ["error", 17],
    ["fatal", 21],
  ] as const)("mức %s có số OTel %i", (level, n) => {
    const { log, last } = setup();
    log[level]("m");
    expect(last().level).toBe(level);
    expect(last().severity_number).toBe(n);
  });

  it("child gắn request_id/trace_id vào mọi bản ghi và không bị trường gọi ghi đè trường lõi", () => {
    const { log, last } = setup();
    log.child({ request_id: "r-1", trace_id: "t-1" }).info("x", {
      service: "giả mạo",
      timestamp: "1999",
    });
    expect(last().request_id).toBe("r-1");
    expect(last().trace_id).toBe("t-1");
    expect(last().service).toBe("social-manager");
    expect(last().timestamp).toBe("2026-11-22T03:04:05.678Z");
  });
});

describe("che bí mật (BASE-ERR-007)", () => {
  it("che khoá nhạy cảm ở mọi độ sâu, không phân biệt hoa thường", () => {
    const { log, last } = setup();
    log.info("m", {
      password: "p",
      nested: { Authorization: "Bearer x", list: [{ api_key: "k" }] },
      cookie: "c",
      sessionToken: "s",
      ok: "giữ",
    });
    const rec = last();
    expect(rec.password).toBe("[REDACTED]");
    expect(rec.cookie).toBe("[REDACTED]");
    expect(rec.sessionToken).toBe("[REDACTED]");
    expect(rec.nested).toEqual({
      Authorization: "[REDACTED]",
      list: [{ api_key: "[REDACTED]" }],
    });
    expect(rec.ok).toBe("giữ");
  });

  it("che mật khẩu trong chuỗi kết nối nằm trong giá trị tự do", () => {
    const { log, lines } = setup();
    log.error("lỗi nối postgres://app:s3cr3t@db:5432/x thất bại");
    expect(lines[0]).not.toContain("s3cr3t");
    expect(lines[0]).toContain("postgres://app:[REDACTED]@db:5432/x");
  });

  it("chịu được tham chiếu vòng và cây quá sâu mà không ném", () => {
    const { log, last } = setup();
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(() => log.info("m", { a })).not.toThrow();
    expect((last().a as Record<string, unknown>).self).toBe("[Circular]");
  });
});

describe("chống log injection (BASE-ERR-008)", () => {
  it("chuỗi chứa xuống dòng giả không tạo bản ghi thứ hai", () => {
    const { log, lines, last } = setup();
    log.info("đăng nhập\n[ERROR] fake\r\n", { user: "a\nb\u0007" });
    expect(lines).toHaveLength(1);
    expect(lines[0].split("\n")).toHaveLength(1);
    expect(last().message).toBe("đăng nhập\\n[ERROR] fake\\r\\n");
    expect(last().user).toBe("a\\nb\\u0007");
  });

  it("không đụng ký tự Unicode hợp lệ (tiếng Việt, emoji)", () => {
    const { log, last } = setup();
    log.info("Xin chào 👋 Việt Nam");
    expect(last().message).toBe("Xin chào 👋 Việt Nam");
  });
});

describe("ngoại lệ (BASE-ERR-009)", () => {
  it("ghi exception.type/message/stacktrace và chuỗi nguyên nhân đầy đủ", () => {
    const { log, last } = setup();
    const root = new TypeError("gốc");
    const mid = new Error("giữa", { cause: root });
    const top = new RangeError("ngoài", { cause: mid });
    log.error("hỏng", { error: top });
    const rec = last();
    expect(rec["exception.type"]).toBe("RangeError");
    expect(rec["exception.message"]).toBe("ngoài");
    expect(String(rec["exception.stacktrace"])).toContain("RangeError: ngoài");
    const cause1 = rec["exception.cause"] as Record<string, string>;
    expect(cause1["exception.type"]).toBe("Error");
    expect(cause1["exception.message"]).toBe("giữa");
    const cause2 = (
      cause1 as unknown as Record<string, Record<string, string>>
    )["exception.cause"];
    expect(cause2["exception.type"]).toBe("TypeError");
    expect(cause2["exception.message"]).toBe("gốc");
    expect(rec.error).toBeUndefined();
  });

  it("giá trị ném không phải Error vẫn được ghi, và vòng nguyên nhân không treo", () => {
    const { log, last } = setup();
    log.error("hỏng", { error: "chuỗi trần" });
    expect(last()["exception.message"]).toBe("chuỗi trần");
    const e1 = new Error("a");
    const e2 = new Error("b", { cause: e1 });
    (e1 as { cause?: unknown }).cause = e2;
    expect(() => log.error("vòng", { error: e1 })).not.toThrow();
  });

  it("thông điệp lỗi cũng được che bí mật và escape", () => {
    const { log, lines } = setup();
    log.error("x", { error: new Error("nối postgres://u:pw@h/db\nfake") });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(":pw@");
  });
});

describe("không ghi log ra file (BASE-ERR-005)", () => {
  it("mã sản phẩm không dùng appendFile/createWriteStream", async () => {
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(
      "git",
      ["grep", "-nE", "appendFile|createWriteStream", "--", "src", "app"],
      { encoding: "utf-8" },
    );
    expect(r.status).toBe(1); // 1 = không có kết quả khớp
    expect(r.stdout).toBe("");
  });
});
