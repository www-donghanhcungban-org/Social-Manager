import { readFileSync } from "node:fs";

import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { isCsrfOriginAllowed } from "next/dist/server/app-render/csrf-protection";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { config, proxy } from "@/proxy";

import { createWorld, type World } from "./world";

/**
 * CSRF cho Server Action và route đổi trạng thái. Cơ chế ĐANG DÙNG (không có token CSRF riêng):
 *  1. `proxy.ts` (lớp của dự án) chặn mọi method không an toàn có `Sec-Fetch-Site` khác same-origin/none, hoặc thiếu nó mà
 *     `Origin` lệch `Host`, hoặc thiếu cả hai mà mang cookie → 403 trước khi tới Server Action/route.
 *  2. Next tự so `Origin` với `Host`/`X-Forwarded-Host` cho Server Action (`isCsrfOriginAllowed` + `serverActions.allowedOrigins`
 *     — dự án không nới danh sách này).
 *  3. Better Auth kiểm Origin với `trustedOrigins` khi request có cookie; cookie phiên SameSite=Lax.
 * Giới hạn đã biết, ghi lại thay vì giả vờ kiểm: Better Auth TỰ TẮT kiểm Origin khi NODE_ENV=test (create-context:
 * `skipOriginCheck: isTest() ? true : false`), nên lớp 3 không kiểm được trong vitest — E2E `e2e/security-headers.spec.ts`
 * đánh vào server build thật. Thực thi đầy đủ lớp 2 cần server Next đang chạy; ở đây kiểm hàm quyết định của Next với cấu
 * hình của dự án.
 */
const APP = "https://app.example.com";
const SERVER_ACTION = `${APP}/app/2f1c7a4e-0000-4000-8000-000000000001/conversations/2f1c7a4e-0000-4000-8000-000000000002`;

function call(url: string, method: string, headers: Record<string, string>) {
  return proxy(
    new NextRequest(url, {
      method,
      headers: { host: "app.example.com", ...headers },
    }),
  );
}
const COOKIE = { cookie: "__Host-sm.session_token=abc.def" };
const ACTION = { "next-action": "7f3a9c", "content-type": "text/plain" };

describe("proxy (lớp 1): request đổi trạng thái từ trang khác bị 403 trước Server Action", () => {
  it.each([
    ["Sec-Fetch-Site cross-site", { "sec-fetch-site": "cross-site" }],
    [
      "Sec-Fetch-Site same-site (subdomain bị chiếm)",
      { "sec-fetch-site": "same-site" },
    ],
    [
      "Origin trang lạ, không Sec-Fetch-Site",
      { origin: "https://evil.example" },
    ],
    ["Origin 'null' (iframe sandbox, data:)", { origin: "null" }],
    [
      "Origin cùng tên miền khác cổng",
      { origin: "https://app.example.com:8443" },
    ],
    [
      "Origin tên miền đuôi giống",
      { origin: "https://app.example.com.evil.example" },
    ],
    ["không Origin, không Sec-Fetch-Site, có cookie", {}],
  ])("Server Action POST + cookie, %s → 403", async (_name, h) => {
    const res = call(SERVER_ACTION, "POST", { ...COOKIE, ...ACTION, ...h });
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("mọi method không an toàn và mọi đường đổi trạng thái (đăng xuất, xuất dữ liệu, action) đều bị chặn", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"])
      for (const url of [
        SERVER_ACTION,
        `${APP}/api/auth/sign-out`,
        `${APP}/app/account/export`,
        `${APP}/app`,
      ])
        expect(
          call(url, method, { ...COOKIE, "sec-fetch-site": "cross-site" })
            .status,
          `${method} ${url}`,
        ).toBe(403);
  });

  it("đối chứng: cùng nguồn đi tiếp; GET cross-site (điều hướng) không bị chặn; webhook máy-máy không cookie đi tiếp", async () => {
    const same = call(SERVER_ACTION, "POST", {
      ...COOKIE,
      ...ACTION,
      "sec-fetch-site": "same-origin",
      origin: APP,
    });
    expect(same.status).toBe(200);
    expect(same.headers.get("x-middleware-next")).toBe("1");
    expect(
      call(SERVER_ACTION, "GET", { ...COOKIE, "sec-fetch-site": "cross-site" })
        .status,
    ).toBe(200);
    expect(
      call(`${APP}/api/webhooks/socialapi/x`, "POST", {
        "content-type": "application/json",
      }).status,
    ).toBe(200);
  });

  it("proxy chạy cho trang/action, route auth và webhook; chỉ bỏ tài nguyên tĩnh", () => {
    const matches = (url: string, headers?: Record<string, string>) =>
      unstable_doesMiddlewareMatch({ config, url, headers });
    for (const url of [
      SERVER_ACTION,
      `${APP}/app`,
      `${APP}/api/auth/sign-out`,
      `${APP}/api/webhooks/socialapi/x`,
      `${APP}/login`,
    ])
      expect(matches(url), url).toBe(true);
    expect(matches(`${APP}/_next/static/chunk.js`)).toBe(false);
    // Giới hạn: request mang header `next-router-prefetch` bỏ qua proxy. Trang khác không gắn được header tuỳ ý mà không
    // qua preflight CORS (app không trả header CORS nào), và Server Action vẫn qua kiểm Origin của Next (lớp 2).
    expect(matches(SERVER_ACTION, { "next-router-prefetch": "1" })).toBe(false);
  });
});

describe("Next (lớp 2): kiểm Origin của Server Action không bị nới", () => {
  it("next.config không khai serverActions.allowedOrigins; Origin lạ không được Next chấp nhận", () => {
    const cfg = readFileSync("next.config.mjs", "utf-8");
    expect(cfg).not.toMatch(/allowedOrigins|serverActions/);
    for (const origin of [
      "evil.example",
      "app.example.com.evil.example",
      "null",
    ])
      expect(isCsrfOriginAllowed(origin, undefined), origin).toBe(false);
    // Đối chứng: hàm thật sự chấp nhận khi có danh sách (tránh test xanh vì hàm luôn false).
    expect(isCsrfOriginAllowed("evil.example", ["evil.example"])).toBe(true);
  });
});

describe("Better Auth (lớp 3): cấu hình không tắt kiểm Origin/CSRF", () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(async () => {
    await w.t.client.close();
  });

  it("createAuth không đặt disableOriginCheck/disableCSRFCheck, không trustedOrigins wildcard; cookie SameSite=Lax HttpOnly", async () => {
    const o = w.auth.options as {
      advanced?: { disableOriginCheck?: unknown; disableCSRFCheck?: unknown };
      trustedOrigins?: unknown;
    };
    expect(o.advanced?.disableOriginCheck).toBeUndefined();
    expect(o.advanced?.disableCSRFCheck).toBeUndefined();
    expect(JSON.stringify(o.trustedOrigins ?? [])).not.toContain("*");
    await w.auth.api.signUpEmail({
      body: {
        name: "Lan",
        email: "lan@example.com",
        password: "mat-khau-du-dai-123",
      },
    });
    const { headers } = await w.auth.api.signInEmail({
      body: { email: "lan@example.com", password: "mat-khau-du-dai-123" },
      returnHeaders: true,
    });
    const session = headers
      .getSetCookie()
      .find((c) => c.includes("session_token="))!;
    expect(session).toMatch(/;\s*SameSite=Lax/i);
    expect(session).toMatch(/;\s*HttpOnly/i);
  });
});
