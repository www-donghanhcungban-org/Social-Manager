import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const runbook = readFileSync("docs/RUNBOOK.md", "utf-8");
const compose = readFileSync("docker-compose.yml", "utf-8");

describe("RUNBOOK.md (BASE-DOC-004)", () => {
  it("có đủ các mục của mẫu", () => {
    for (const h of [
      "## 0. Thông tin nhanh",
      "## 1. Lệnh vận hành (chép-chạy)",
      "### Kiểm tra sức khoẻ",
      "### Deploy",
      "### Rollback",
      "### Migration CSDL",
      "### Backup và khôi phục",
      "### Xoay bí mật",
      "## 2. Cảnh báo → playbook",
      "## 4. Leo thang",
    ])
      expect(runbook, h).toContain(h);
  });

  it("mọi tệp/script được nhắc tới đều có thật", () => {
    const paths = [
      ...runbook.matchAll(
        /(?:scripts|drizzle|docs)\/[A-Za-z0-9_./-]+\.(?:mjs|sql|md)/g,
      ),
    ].map((m) => m[0]);
    expect(paths.length).toBeGreaterThan(2);
    for (const p of new Set(paths)) expect(existsSync(p), p).toBe(true);
    expect(existsSync("app/api/health/route.ts")).toBe(true);
    expect(runbook).toContain("/api/health");
  });

  it("nêu đủ bốn biến bí mật bắt buộc của compose và không ghi giá trị", () => {
    const required = [...compose.matchAll(/\$\{(\w+):\?/g)].map((m) => m[1]!);
    expect(required.length).toBeGreaterThanOrEqual(4);
    for (const v of required) expect(runbook, v).toContain(v);
    expect(runbook).not.toMatch(
      /(SECRET|PASSWORD|KEY)\s*=\s*[A-Za-z0-9+/]{16,}/,
    );
  });

  it("thông điệp log được dẫn trong playbook có trong mã", () => {
    const logs = [...runbook.matchAll(/log `([^`]+)`/g)].map((m) => m[1]!);
    expect(logs.length).toBeGreaterThan(0);
    const src = ["src/jobs/start.ts", "instrumentation.ts"]
      .map((f) => readFileSync(f, "utf-8"))
      .join("\n");
    for (const l of logs) expect(src, l).toContain(l);
  });

  it("nói thật phần chưa có: cảnh báo tự động và diễn tập", () => {
    expect(runbook).toMatch(/chưa có hệ thống cảnh báo/i);
    expect(runbook).toMatch(/chưa diễn tập/i);
  });
});
