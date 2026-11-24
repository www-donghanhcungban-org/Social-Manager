import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { AUDIT_ACTIONS } from "@/src/audit/record";
import { ForbiddenError } from "@/src/auth/errors";
import { handleError } from "@/src/http/errors";
import { createLogger } from "@/src/log/logger";
import {
  logSecurityEvent,
  SECURITY_EVENTS,
  securityEventFields,
} from "@/src/log/security-events";
import { ValidationError } from "@/src/providers/types";

const doc = readFileSync("docs/security/security-events.md", "utf-8");
const schema = JSON.parse(
  readFileSync("docs/security/security-event.schema.json", "utf-8"),
) as {
  required: string[];
  properties: Record<string, { enum?: string[]; pattern?: string }>;
};

const names = (section: string) =>
  [...section.matchAll(/^\| `([a-z_.]+)`\s+\|/gm)].map((m) => m[1]!).sort();
const [, sec1 = "", sec2 = ""] = doc.split(/^## \d\. /m);

function capture() {
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({
    service: "t",
    version: "0",
    env: "test",
    write: (l) => lines.push(JSON.parse(l) as Record<string, unknown>),
  });
  return { lines, log };
}

/** Kiểm một dòng log theo schema (đủ trường bắt buộc, enum, mẫu). */
function validate(line: Record<string, unknown>) {
  for (const k of schema.required) expect(line, k).toHaveProperty(k);
  for (const [k, def] of Object.entries(schema.properties)) {
    const v = line[k];
    if (def.enum && v !== undefined) expect(def.enum, k).toContain(v);
    if (def.pattern && typeof v === "string")
      expect(v, k).toMatch(new RegExp(def.pattern));
  }
}

describe("sự kiện bảo mật (SEC-LOG-001/002)", () => {
  it("bảng docs/security/security-events.md khớp danh sách sự kiện và hành động audit trong mã", () => {
    expect(names(sec1)).toEqual([...SECURITY_EVENTS].sort());
    expect(names(sec2)).toEqual([...AUDIT_ACTIONS].sort());
  });

  it("mỗi sự kiện sinh đúng một dòng log có đủ trường chuẩn, timestamp UTC", () => {
    for (const event of SECURITY_EVENTS) {
      const { lines, log } = capture();
      logSecurityEvent(log, {
        event,
        outcome: "denied",
        actor: "u1",
        targetType: "workspace",
        targetId: "w1",
        sourceIp: "203.0.113.9",
        userAgent: "UA/1.0",
        requestId: "r1",
      });
      expect(lines, event).toHaveLength(1);
      validate(lines[0]!);
      expect(lines[0]).toMatchObject({
        event,
        actor: "u1",
        target_type: "workspace",
        target_id: "w1",
        outcome: "denied",
        source_ip: "203.0.113.9",
        user_agent: "UA/1.0",
        request_id: "r1",
        level: "warn",
      });
    }
  });

  it("trường chưa biết ghi null (không bỏ trống), actor mặc định anonymous; thành công mức info", () => {
    const f = securityEventFields({
      event: "auth.login_failed",
      outcome: "denied",
    });
    expect(f).toMatchObject({
      actor: "anonymous",
      target_type: null,
      source_ip: null,
      user_agent: null,
      request_id: null,
    });
    const { lines, log } = capture();
    logSecurityEvent(log, {
      event: "auth.login_succeeded",
      outcome: "success",
    });
    expect(lines[0]).toMatchObject({ level: "info" });
    validate(lines[0]!);
  });

  it("user-agent bị cắt 256 ký tự và ký tự điều khiển bị escape (chống log injection)", () => {
    const { lines, log } = capture();
    logSecurityEvent(log, {
      event: "input.invalid",
      outcome: "denied",
      userAgent: "A".repeat(400) + '\n{"fake":1}',
    });
    expect((lines[0]!.user_agent as string).length).toBeLessThanOrEqual(256);
    validate(lines[0]!);
    const { lines: l2, log: log2 } = capture();
    logSecurityEvent(log2, {
      event: "input.invalid",
      outcome: "denied",
      userAgent: "x\ny",
    });
    expect(l2[0]!.user_agent).toBe("x\\ny");
  });

  it("handleError: 403 ghi authz.denied, 422 ghi input.invalid, lỗi khác không ghi sự kiện bảo mật", () => {
    const a = capture();
    handleError(new ForbiddenError(), {
      log: a.log,
      requestId: "req-1",
      who: { actor: "u9", sourceIp: "198.51.100.1", userAgent: "ua" },
    });
    expect(a.lines.find((l) => l.event === "authz.denied")).toMatchObject({
      actor: "u9",
      source_ip: "198.51.100.1",
      request_id: "req-1",
      outcome: "denied",
    });
    const b = capture();
    handleError(new ValidationError("x"), { log: b.log, requestId: "r2" });
    expect(b.lines.find((l) => l.event === "input.invalid")).toBeDefined();
    const c = capture();
    handleError(new Error("boom"), { log: c.log, requestId: "r3" });
    expect(c.lines.some((l) => l.security_event === true)).toBe(false);
  });

  it("sự kiện đăng nhập được phát từ hook xác thực (đủ ba loại)", () => {
    const src = readFileSync("src/auth/auth.ts", "utf-8");
    for (const e of [
      "auth.login_succeeded",
      "auth.login_failed",
      "auth.login_locked",
    ])
      expect(src, e).toContain(`"${e}"`);
    expect(
      readFileSync(
        "app/api/webhooks/socialapi/[connectionId]/route.ts",
        "utf-8",
      ),
    ).toContain('"webhook.signature_invalid"');
  });

  it("danh sách sự kiện chỉ có tên dạng nhóm.hành_động", () => {
    for (const e of SECURITY_EVENTS) expect(e).toMatch(/^[a-z]+\.[a-z_]+$/);
    for (const e of AUDIT_ACTIONS) expect(e).toMatch(/^[a-z]+\.[a-z_]+$/);
  });
});

describe("che định danh cá nhân trong log (CMP-PRIV-008, OPS-OBS-008)", () => {
  it("email và số điện thoại Việt Nam bị che ở thông điệp và trường; id, số thường được giữ", () => {
    const { lines, log } = capture();
    log.info("khách an@example.com gọi 0912 345 678", {
      note: "liên hệ +84 912345678 hoặc b.c+d@example.org",
      nested: { who: "x@example.net" },
      order_id: "a3b1c2d4-0000-4000-8000-123456789012",
      ts: 1795479563411,
      count: 1234567890,
    });
    const all = JSON.stringify(lines[0]);
    expect(all).not.toMatch(/@example\.(com|org|net)/);
    expect(all).not.toMatch(/0912|345 678|912345678/);
    expect(lines[0]).toMatchObject({
      order_id: "a3b1c2d4-0000-4000-8000-123456789012",
      ts: 1795479563411,
      count: 1234567890,
    });
    expect(all).toContain("[EMAIL]");
    expect(all).toContain("[PHONE]");
  });

  it("không phụ thuộc OpenTelemetry SDK/Collector (OPS-OBS-008 không áp dụng): thêm gói @opentelemetry thì test đỏ", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(all.filter((d) => d.startsWith("@opentelemetry/"))).toEqual([]);
  });
});
