import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as live } from "@/app/api/health/live/route";
import { GET as metricsRoute } from "@/app/api/metrics/route";
import {
  createMetrics,
  MAX_SERIES,
  metrics as shared,
} from "@/src/observability/metrics";
import { timed } from "@/src/observability/instrument";
import {
  checkMetricsAccess,
  MIN_METRICS_TOKEN,
} from "@/src/observability/metrics-auth";

afterEach(() => vi.unstubAllEnvs());

describe("metric RED (OPS-OBS-003)", () => {
  it("histogram http.server.request.duration có phương thức, route mẫu, mã trạng thái, bucket cộng dồn", () => {
    const m = createMetrics();
    m.observeHttp({
      method: "get",
      route: "/api/health",
      status: 200,
      seconds: 0.02,
    });
    m.observeHttp({
      method: "GET",
      route: "/api/health",
      status: 200,
      seconds: 3,
    });
    const text = m.render();
    expect(text).toContain(
      "# TYPE http_server_request_duration_seconds histogram",
    );
    const base =
      'http.request.method="GET",http.response.status_code="200",http.route="/api/health"';
    expect(text).toContain(
      `http_server_request_duration_seconds_bucket{${base},le="0.025"} 1`,
    );
    expect(text).toContain(
      `http_server_request_duration_seconds_bucket{${base},le="5"} 2`,
    );
    expect(text).toContain(
      `http_server_request_duration_seconds_count{${base}} 2`,
    );
    expect(text).toContain(
      `http_server_request_duration_seconds_sum{${base}} 3.02`,
    );
  });

  it("số series bị chặn: nhãn mới vượt trần gộp vào `other`, không phình bộ nhớ", () => {
    const m = createMetrics();
    for (let i = 0; i < MAX_SERIES + 300; i++)
      m.observeHttp({
        method: "GET",
        route: `/r${i}`,
        status: 200,
        seconds: 0.1,
      });
    expect(m.seriesCount()).toBeLessThanOrEqual(MAX_SERIES + 1);
    expect(m.render()).toContain('http.route="other"');
    // ngưỡng của blueprint: < 10k series
    expect(m.seriesCount()).toBeLessThan(10_000);
  });

  it("nhãn được escape (không phá định dạng văn bản)", () => {
    const m = createMetrics();
    m.observeHttp({
      method: "GET",
      route: '/a"b\\c\nd',
      status: 200,
      seconds: 0,
    });
    expect(m.render()).not.toMatch(/\nd"/);
  });

  it("timed() đo cả khi handler ném lỗi (mã 500) và giữ nguyên phản hồi", async () => {
    const before = shared.render();
    const ok = timed(
      "GET",
      "/t/ok",
      async () => new Response("x", { status: 201 }),
    );
    expect((await ok()).status).toBe(201);
    const bad = timed("GET", "/t/bad", async () => {
      throw new Error("boom");
    });
    await expect(bad()).rejects.toThrow("boom");
    const after = shared.render();
    expect(after).not.toBe(before);
    expect(after).toContain(
      'http.response.status_code="201",http.route="/t/ok"',
    );
    expect(after).toContain(
      'http.response.status_code="500",http.route="/t/bad"',
    );
  });

  it("counter token LLM bỏ qua số âm/NaN", () => {
    const m = createMetrics();
    const base = {
      tenant: "w",
      feature: "f",
      model: "m",
      direction: "input" as const,
    };
    m.addLlmTokens({ ...base, tokens: -1 });
    m.addLlmTokens({ ...base, tokens: Number.NaN });
    m.addLlmTokens({ ...base, tokens: 7 });
    expect(m.render()).toContain(
      'llm_tokens_total{direction="input",feature="f",model="m",tenant="w"} 7',
    );
  });
});

describe("/api/metrics đóng mặc định, mở bằng Bearer", () => {
  const token = "t".repeat(MIN_METRICS_TOKEN);
  const req = (auth?: string) =>
    new Request("http://x/api/metrics", {
      headers: auth ? { authorization: auth } : {},
    });

  it("không cấu hình hoặc token ngắn → 404 (như không tồn tại)", async () => {
    vi.stubEnv("METRICS_TOKEN", "");
    expect((await metricsRoute(req(`Bearer ${token}`))).status).toBe(404);
    vi.stubEnv("METRICS_TOKEN", "ngan");
    expect((await metricsRoute(req("Bearer ngan"))).status).toBe(404);
  });

  it("có token: thiếu/sai → 401; đúng → 200 văn bản Prometheus không cache", async () => {
    vi.stubEnv("METRICS_TOKEN", token);
    expect((await metricsRoute(req())).status).toBe(401);
    expect((await metricsRoute(req("Bearer sai"))).status).toBe(401);
    expect((await metricsRoute(req(`Basic ${token}`))).status).toBe(401);
    const ok = await metricsRoute(req(`Bearer ${token}`));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(await ok.text()).toContain("# TYPE llm_tokens_total counter");
  });

  it("checkMetricsAccess: độ dài khác nhau không ném lỗi", () => {
    expect(checkMetricsAccess(token, "Bearer x")).toBe("denied");
    expect(checkMetricsAccess(token, null)).toBe("denied");
    expect(checkMetricsAccess(undefined, "Bearer x")).toBe("disabled");
  });
});

describe("liveness /api/health/live (OPS-OBS-006)", () => {
  it("trả ok mà không chạm phụ thuộc, không lộ chi tiết, không cache", async () => {
    const res = await live();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
