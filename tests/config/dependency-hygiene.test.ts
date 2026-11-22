import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf-8");

describe("quét phụ thuộc và hạn runtime trong CI (BASE-DEP-003/004)", () => {
  it("dep-audit chạy trên mỗi PR và theo lịch hằng tuần, đỏ từ mức high", () => {
    const wf = read(".github/workflows/dep-audit.yml");
    expect(wf).toMatch(/pull_request:/);
    expect(wf).toMatch(/cron: "[^"]+ \* \* 1"/);
    expect(wf).toContain("npm audit --audit-level=high");
    expect(wf).not.toContain("continue-on-error");
  });

  it("ngoại lệ phụ thuộc: mỗi dòng có hạn ISO còn hiệu lực, không quá 1 năm", () => {
    const rows = read("docs/ops-notes/dependency-exceptions.md")
      .split("\n")
      .filter((l) => /^\| `/.test(l));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const now = Date.now();
    for (const row of rows) {
      const due = /\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*$/.exec(row)?.[1];
      expect(due, row).toBeDefined();
      const t = Date.parse(`${due}T00:00:00Z`);
      expect(t, `quá hạn: ${row}`).toBeGreaterThan(now);
      expect(t - now, `hạn quá xa: ${row}`).toBeLessThan(366 * 86_400_000);
    }
  });

  it("lockfile không còn minimatch trong dải có lỗ hổng GHSA-g3hv-75wg-m249 (7.0.0–11.0.0)", () => {
    const lock = JSON.parse(read("package-lock.json")) as {
      packages: Record<string, { version?: string }>;
    };
    const bad = Object.entries(lock.packages)
      .filter(([k]) => /(^|\/)node_modules\/minimatch$/.test(k))
      .filter(([, v]) => {
        const major = Number(v.version?.split(".")[0]);
        return major >= 7 && major <= 10;
      })
      .map(([k, v]) => `${k}@${v.version}`);
    expect(bad).toEqual([]);
  });

  it("runtime-eol: kiểm .nvmrc với endoflife.date hằng tuần, ngưỡng 90 ngày, quyền chỉ đọc", () => {
    const wf = read(".github/workflows/runtime-eol.yml");
    expect(wf).toContain("https://endoflife.date/api/nodejs.json");
    expect(wf).toContain("+90 days");
    expect(wf).toMatch(/cron: "[^"]+ \* \* 1"/);
    expect(wf).toMatch(/permissions:\n {2}contents: read/);
    expect(wf).toMatch(/actions\/checkout@[0-9a-f]{40}/);
    expect(wf).not.toContain("continue-on-error");
  });
});
