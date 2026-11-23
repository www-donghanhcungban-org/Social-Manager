import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { DB_TIMEOUTS, poolConfig } from "@/src/db/client";
import { createSocialApiClient } from "@/src/providers/socialapi";

/**
 * MUST nhóm bền bỉ và CSDL (T-520): mỗi `it` nêu ID nó giữ. Blueprint tick kèm
 * `— Kiểm: npx vitest run tests/http/resilience.test.ts …`.
 */
const read = (f: string) => readFileSync(f, "utf-8");
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const code = (dir: string) => walk(dir).filter((f) => /\.(ts|tsx)$/.test(f));

describe("timeout tường minh mọi client (ARC-RES-001, BE-REL-001)", () => {
  it("mọi tệp trong src/ có gọi fetch đều đặt AbortSignal.timeout", () => {
    const callers = code("src").filter((f) =>
      /(?<![.\w])fetch\(|doFetch\(/.test(read(f)),
    );
    expect(callers.length).toBeGreaterThanOrEqual(3);
    for (const f of callers)
      expect(read(f), f).toMatch(/AbortSignal\.timeout\(/);
  });

  it("pool CSDL và pg-boss có timeout kết nối/câu lệnh/idle-in-transaction khác 0", () => {
    const cfg = poolConfig("postgres://u:p@h/d");
    for (const k of [
      "connectionTimeoutMillis",
      "statement_timeout",
      "idle_in_transaction_session_timeout",
      "query_timeout",
      "idleTimeoutMillis",
    ] as const)
      expect(cfg[k], k).toBeGreaterThan(0);
    expect(read("src/jobs/pgboss.ts")).toMatch(
      /connectionTimeoutMillis:\s*\d+/,
    );
  });

  it("phụ thuộc treo → lỗi timeout trong ngưỡng, không chờ vô hạn", async () => {
    const hang: typeof fetch = (_u, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("abort")),
        );
      });
    const c = createSocialApiClient({
      apiKey: "k",
      fetch: hang,
      timeoutMs: 30,
    });
    const t0 = Date.now();
    await expect(c.get("/x", z.object({}))).rejects.toMatchObject({
      code: "client.timeout",
    });
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe("retry có giới hạn (ARC-RES-002, BE-REL-003)", () => {
  const Ok = z.object({ ok: z.boolean() });
  const make = (res: () => Response | Promise<Response>) => {
    const fetchMock = vi.fn(async () => res());
    const sleep = vi.fn(async () => {});
    const c = createSocialApiClient({
      apiKey: "k",
      fetch: fetchMock as unknown as typeof fetch,
      sleep,
    });
    return { c, fetchMock, sleep };
  };

  it("4xx nghiệp vụ và 5xx không tự thử lại (1 lần gọi)", async () => {
    for (const status of [400, 401, 404, 500, 503]) {
      const { c, fetchMock, sleep } = make(
        () => new Response("{}", { status }),
      );
      await expect(c.get("/x", Ok)).rejects.toMatchObject({ status });
      expect(fetchMock, String(status)).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    }
  });

  it("429 có Retry-After: tối đa 3 lần gọi (mặc định 3 lần), chờ theo Retry-After có trần", async () => {
    const { c, fetchMock, sleep } = make(
      () =>
        new Response("{}", { status: 429, headers: { "Retry-After": "999" } }),
    );
    await expect(c.get("/x", Ok)).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    for (const [ms] of sleep.mock.calls as unknown as number[][])
      expect(ms).toBeLessThanOrEqual(30_000);
  });

  it("lỗi mạng/timeout khi POST không tự thử lại (không idempotent)", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("mạng đứt");
    });
    const c = createSocialApiClient({
      apiKey: "k",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(c.post("/x", { a: 1 }, Ok)).rejects.toMatchObject({
      code: "client.network",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("giới hạn danh sách (XC-PERF-006)", () => {
  it("danh sách có limit mặc định và trần; yêu cầu quá lớn bị kẹp (test ở từng dịch vụ)", () => {
    expect(read("src/inbox/service.ts")).toMatch(/MAX_LIMIT = 100/);
    expect(read("src/search/service.ts")).toMatch(/MAX_LIMIT = 50/);
    expect(read("src/conversations/threads.ts")).toMatch(/MAX_LIST/);
    expect(read("tests/inbox/service.test.ts")).toMatch(/limit: 9999/);
    expect(read("tests/search/service.test.ts")).toMatch(/limit: 9999/);
    expect(read("tests/conversations/threads.test.ts")).toMatch(
      /limit: 100000/,
    );
    expect(read("src/inbox/webhook.ts")).toMatch(/MAX_WEBHOOK_BYTES/);
  });
});

describe("pool và vai trò CSDL (DB-PERF-004, DB-PERF-005)", () => {
  it("DB-PERF-004: pool có trần tường minh; tổng kết nối 1 bản sao ≤ max_connections mặc định, có bảng tính", () => {
    expect(DB_TIMEOUTS.max).toBeGreaterThan(0);
    const boss = Number(/max:\s*(\d+)/.exec(read("src/jobs/pgboss.ts"))?.[1]);
    expect(boss).toBeGreaterThan(0);
    const reserve = 5;
    expect(DB_TIMEOUTS.max + boss + reserve).toBeLessThanOrEqual(100);
    const doc = read("docs/db/connections.md");
    expect(doc).toMatch(/Bảng tính tổng kết nối/);
    expect(doc).toContain(`| ${DB_TIMEOUTS.max} `);
    expect(doc).toContain(`| ${boss} `);
  });

  it("DB-PERF-005: statement_timeout và idle_in_transaction_session_timeout đặt ở mức kết nối của vai trò app, không ở postgresql.conf", () => {
    expect(DB_TIMEOUTS.statement_timeout).toBeGreaterThan(0);
    expect(DB_TIMEOUTS.idle_in_transaction_session_timeout).toBeGreaterThan(0);
    expect(read("docker-compose.yml")).not.toMatch(
      /statement_timeout|postgresql\.conf/,
    );
  });
});

describe("giao dịch (DB-TX-001/002/003)", () => {
  it("DB-TX-001: đọc-rồi-ghi có điều kiện được khoá và có test đồng thời (owner cuối, dispatch, đăng bài, bỏ nháp)", () => {
    expect(read("src/auth/members.ts")).toMatch(/\.for\("no key update"\)/);
    expect(read("src/posts/service.ts")).toMatch(/\.for\("update"/);
    expect(read("tests/auth/members.pg.test.ts")).toMatch(/Promise\.all/);
    expect(read("tests/actions/ledger.test.ts")).toMatch(
      /hai dispatch song song: chỉ một thắng/,
    );
    expect(read("tests/actions/discard-after-queue.test.ts")).toMatch(
      /bỏ nháp và gửi chạy song song/,
    );
  });

  it("DB-TX-002: không giao dịch nào dùng REPEATABLE READ/SERIALIZABLE (nên không cần bọc retry 40001/40P01)", () => {
    const offenders = [...code("src"), ...code("app")].filter((f) =>
      /isolationLevel|ISOLATION LEVEL|SERIALIZABLE|REPEATABLE READ/i.test(
        read(f),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("DB-TX-003: không gọi mạng/hàng đợi trong transaction (tests/inbox/integration-patterns.test.ts) và idle_in_transaction_session_timeout bật", () => {
    expect(read("tests/inbox/integration-patterns.test.ts")).toMatch(
      /không có lời gọi mạng\/hàng đợi\/nhà cung cấp bên trong khối transaction/,
    );
    expect(DB_TIMEOUTS.idle_in_transaction_session_timeout).toBeGreaterThan(0);
  });
});

describe("phía client không tự thử lại (FE-STATE-005)", () => {
  it("không dùng thư viện lấy dữ liệu/retry ở trình duyệt và không có fetch trong file giao diện", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies: Record<string, string>;
    };
    for (const lib of ["swr", "@tanstack/react-query", "axios", "ky"])
      expect(Object.keys(pkg.dependencies), lib).not.toContain(lib);
    const clientFiles = code("app").filter((f) =>
      /^\s*["']use client["']/m.test(read(f)),
    );
    expect(clientFiles.length).toBeGreaterThan(5);
    for (const f of clientFiles) expect(read(f), f).not.toMatch(/\bfetch\(/);
  });
});
