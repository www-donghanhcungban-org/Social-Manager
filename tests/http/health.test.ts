import { describe, expect, it } from "vitest";

import { checkHealth } from "@/src/http/health";

describe("checkHealth", () => {
  it("CSDL trả lời → 200 ok", async () => {
    expect(await checkHealth(async () => {}, 100)).toEqual({
      status: 200,
      body: { status: "ok" },
    });
  });

  it("CSDL lỗi → 503, thân phản hồi không lộ chi tiết lỗi", async () => {
    const r = await checkHealth(async () => {
      throw new Error(
        "password authentication failed for user postgres@10.0.0.5",
      );
    }, 100);
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ status: "degraded" });
    expect(JSON.stringify(r)).not.toMatch(/password|postgres|10\.0/);
  });

  it("CSDL treo → 503 sau thời hạn, không treo theo", async () => {
    const started = Date.now();
    const r = await checkHealth(() => new Promise<void>(() => {}), 50);
    expect(r.status).toBe(503);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
