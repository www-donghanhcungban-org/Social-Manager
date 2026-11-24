import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { smoke } from "../../scripts/smoke.mjs";

/**
 * WF-REL-007, OPS-DEPLOY-004: smoke test sau deploy. Máy chủ giả trả lời theo bảng; smoke phải đỏ khi bất kỳ kiểm tra nào
 * hỏng (để pipeline/người lùi) và xanh khi đủ.
 */
const SECURE = {
  "content-security-policy": "default-src 'self'",
  "strict-transport-security": "max-age=63072000",
  "x-content-type-options": "nosniff",
};

type Route = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
};
const server =
  (routes: Record<string, Route>): typeof fetch =>
  async (input) => {
    const path = new URL(String(input)).pathname;
    const r = routes[path] ?? { status: 404 };
    return new Response(
      typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}),
      { status: r.status, headers: r.headers },
    );
  };

const healthy: Record<string, Route> = {
  "/api/health/live": { status: 200 },
  "/api/health": { status: 200, body: { status: "ok", version: "1.2.3" } },
  "/login": { status: 200, body: "<html></html>", headers: SECURE },
  "/app/account": { status: 307, headers: { location: "/login" } },
  "/api/metrics": { status: 401 },
};

const failures = async (routes: Record<string, Route>, version?: string) =>
  (await smoke("https://xw.test", version, server(routes)))
    .filter((r) => !r.ok)
    .map((r) => r.name);

describe("smoke sau deploy (WF-REL-007, OPS-DEPLOY-004)", () => {
  it("máy chủ khoẻ, đúng phiên bản: không kiểm tra nào đỏ", async () => {
    expect(await failures(healthy, "1.2.3")).toEqual([]);
  });

  it("phiên bản không khớp tag là đỏ", async () => {
    expect(await failures(healthy, "1.2.4")).toEqual(["phiên bản = 1.2.4"]);
  });

  it("thiếu phiên bản trong health khi cần so là đỏ, không so thì bỏ qua", async () => {
    const noVersion = {
      ...healthy,
      "/api/health": { status: 200, body: { status: "ok" } },
    };
    expect(await failures(noVersion, "1.2.3")).toHaveLength(1);
    expect(await failures(noVersion)).toEqual([]);
  });

  it("CSDL hỏng (health 503) là đỏ", async () => {
    const down = {
      ...healthy,
      "/api/health": { status: 503, body: { status: "degraded" } },
    };
    expect(await failures(down)).toEqual([
      "readiness /api/health = 200 và status ok",
    ]);
  });

  it("thiếu header bảo mật là đỏ", async () => {
    const bare = { ...healthy, "/login": { status: 200, body: "x" } };
    expect(await failures(bare)).toEqual([
      "trang đăng nhập trả 200 kèm header bảo mật",
    ]);
  });

  it("metrics mở cho người ngoài (200) là đỏ", async () => {
    const open = { ...healthy, "/api/metrics": { status: 200 } };
    expect(await failures(open)).toEqual([
      "/api/metrics đóng với người không có Bearer",
    ]);
  });

  it("trang riêng tư lộ nội dung khi chưa đăng nhập là đỏ", async () => {
    const leak = {
      ...healthy,
      "/app/account": { status: 200, body: "Tải dữ liệu của tôi" },
    };
    expect(await failures(leak)).toHaveLength(1);
  });

  it("lỗi mạng (máy chủ không trả lời) tính là đỏ chứ không ném ra ngoài", async () => {
    const dead = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const res = await smoke("https://xw.test", undefined, dead);
    expect(res.every((r) => !r.ok)).toBe(true);
    expect(res[0]!.msg).toBe("ECONNREFUSED");
  });

  it("image nhận APP_VERSION qua build arg và compose truyền nó", () => {
    expect(readFileSync("Dockerfile", "utf-8")).toMatch(
      /ARG APP_VERSION[\s\S]*APP_VERSION=\$\{APP_VERSION\}/,
    );
    expect(readFileSync("docker-compose.yml", "utf-8")).toMatch(
      /APP_VERSION: \$\{APP_VERSION:-\}/,
    );
    expect(readFileSync("app/api/health/route.ts", "utf-8")).toMatch(
      /processEnv\(\)\.APP_VERSION/,
    );
  });
});
