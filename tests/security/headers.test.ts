import { describe, expect, it } from "vitest";

import {
  buildCsp,
  cacheControlFor,
  newNonce,
  securityHeaders,
} from "@/src/security/headers";

const directive = (csp: string, name: string) =>
  csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `));

describe("buildCsp (PRF-WEB-007)", () => {
  const csp = buildCsp({ nonce: "abc123", dev: false });

  it("script-src dùng nonce + strict-dynamic, không unsafe-inline/unsafe-eval", () => {
    const s = directive(csp, "script-src")!;
    expect(s).toContain("'nonce-abc123'");
    expect(s).toContain("'strict-dynamic'");
    expect(s).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(s).not.toContain("*");
  });

  it("khoá các hướng tấn công còn lại", () => {
    expect(directive(csp, "default-src")).toBe("default-src 'self'");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
  });

  it("chỉ môi trường dev mới được unsafe-eval (cho React dev tools)", () => {
    expect(
      directive(buildCsp({ nonce: "n", dev: true }), "script-src"),
    ).toContain("'unsafe-eval'");
  });

  it("từ chối nonce rỗng hoặc có ký tự phá chuỗi CSP", () => {
    for (const bad of ["", "a b", "a;b", "a'b", "a\nb"]) {
      expect(() => buildCsp({ nonce: bad, dev: false })).toThrow(/nonce/);
    }
  });
});

describe("newNonce", () => {
  it("base64 an toàn, đủ dài, mỗi lần một giá trị khác", () => {
    const a = newNonce();
    const b = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22,}={0,2}$/);
    expect(a).not.toBe(b);
  });
});

describe("securityHeaders", () => {
  const h = securityHeaders({ nonce: "n1", dev: false });
  it("đủ bộ header bắt buộc", () => {
    expect(h["Content-Security-Policy"]).toContain("'nonce-n1'");
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=\d{8,}/);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toMatch(/camera=\(\)/);
    expect(h["Permissions-Policy"]).toMatch(/microphone=\(\)/);
    expect(h["Permissions-Policy"]).toMatch(/geolocation=\(\)/);
  });
});

describe("cacheControlFor (PRF-WEB-001)", () => {
  it("route theo người dùng không bao giờ cache chung", () => {
    for (const p of [
      "/app",
      "/app/123/inbox",
      "/login",
      "/api/auth/get-session",
    ]) {
      expect(cacheControlFor(p), p).toBe("private, no-store");
    }
  });
  it("route khác không bị ép", () => {
    expect(cacheControlFor("/_next/static/x.js")).toBeUndefined();
    expect(cacheControlFor("/favicon.ico")).toBeUndefined();
  });
  it("không bị lừa bởi đường dẫn na ná", () => {
    expect(cacheControlFor("/application")).toBeUndefined();
    expect(cacheControlFor("/login-help")).toBeUndefined();
  });
});
