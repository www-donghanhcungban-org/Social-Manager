import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * OPS-COST-005: không có đường tạo hoá đơn không giới hạn. Ứng dụng chạy một bản trong compose, KHÔNG autoscale;
 * khi thêm autoscale/nhiều bản sao phải có trần tường minh — test đỏ nếu thêm mà không khai trần.
 */
describe("trần autoscale và concurrency (OPS-COST-005)", () => {
  const compose = readFileSync("docker-compose.yml", "utf-8");

  it("compose không có autoscale hay số bản sao > 1", () => {
    expect(compose).not.toMatch(/autoscal|max_replicas|maxReplicas/i);
    for (const m of compose.matchAll(/replicas:\s*(\d+)/g))
      expect(Number(m[1]), "replicas").toBeLessThanOrEqual(1);
  });

  it("không có IaC autoscale ngoài compose (k8s HPA, terraform autoscaling)", () => {
    for (const f of [
      "k8s",
      "kubernetes",
      "helm",
      "terraform",
      "infra",
      "deploy",
    ])
      expect(existsSync(f), `${f}/ chưa được rà trần autoscale`).toBe(false);
  });

  it("worker nền: mỗi hàng đợi một worker, lấy một job mỗi lần (không batch lớn)", () => {
    const src = readFileSync("src/jobs/pgboss.ts", "utf-8");
    expect(src).not.toMatch(/batchSize\s*:\s*(?!1\b)\d+/);
    expect(src).not.toMatch(/localConcurrency|teamSize|teamConcurrency/);
  });

  it("gọi AI có trần theo workspace (ngân sách 24 giờ) và trần byte mỗi lượt", () => {
    const g = readFileSync("src/ai/gateway.ts", "utf-8");
    expect(g).toContain("maxCallsPerDay");
    expect(g).toContain("MAX_PROMPT_BYTES");
  });
});
