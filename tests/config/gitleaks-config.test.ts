import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const cfg = readFileSync(".gitleaks.toml", "utf-8");

describe("cấu hình gitleaks (BASE-SEC-002)", () => {
  it("dùng luật mặc định", () => {
    expect(cfg).toMatch(/\[extend\]\s*\nuseDefault = true/);
  });

  it("chỉ miễn một luật, chỉ trong e2e/ và tests/, không miễn theo regex nội dung", () => {
    expect(cfg.match(/\[\[allowlists\]\]/g)).toHaveLength(1);
    expect(cfg).toContain('targetRules = ["generic-api-key"]');
    expect(cfg).toMatch(/paths = \['''\^\(e2e\|tests\)\//);
    expect(cfg).not.toMatch(/^\s*regexes\s*=/m);
    expect(cfg).not.toMatch(/^\s*stopwords\s*=/m);
    expect(cfg).not.toMatch(/^\s*commits\s*=/m);
  });

  it("workflow secret-scan quét toàn lịch sử và không có continue-on-error", () => {
    const wf = readFileSync(".github/workflows/secret-scan.yml", "utf-8");
    expect(wf).toContain("fetch-depth: 0");
    expect(wf).toContain("--all");
    expect(wf).not.toContain("continue-on-error");
  });
});
