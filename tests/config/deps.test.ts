import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf-8");
const pkg = JSON.parse(read("package.json")) as {
  dependencies: Record<string, string>;
  engines?: { node?: string };
};

describe("phụ thuộc (BASE-DEP-001/002/003/007)", () => {
  it("lockfile được git theo dõi và không bị .gitignore (BASE-DEP-001)", () => {
    const tracked = spawnSync("git", [
      "ls-files",
      "--error-unmatch",
      "package-lock.json",
    ]);
    expect(tracked.status).toBe(0);
    expect(read(".gitignore")).not.toMatch(/package-lock\.json/);
  });

  it("manifest và lockfile khớp: `npm ci --dry-run` không báo lệch (BASE-DEP-002)", () => {
    const r = spawnSync("npm", ["ci", "--dry-run", "--ignore-scripts"], {
      encoding: "utf-8",
    });
    expect(r.stderr).not.toMatch(
      /can only install packages when your package\.json and package-lock\.json/,
    );
    expect(r.status).toBe(0);
  });

  it("phụ thuộc runtime ghim đúng một phiên bản, không dải ^ ~ * (BASE-DEP-001)", () => {
    const loose = Object.entries(pkg.dependencies).filter(([, v]) =>
      /^[\^~*>]|latest|^$/.test(v),
    );
    // react/next/... đã ghim đúng; ngoại lệ phải ghi tường minh ở đây kèm lý do.
    expect(loose).toEqual([]);
  });

  it("Node theo .nvmrc là bản LTS còn hỗ trợ (22 hoặc 24) (BASE-DEP-003)", () => {
    const major = Number(read(".nvmrc").trim().split(".")[0]);
    expect([22, 24]).toContain(major);
  });

  it("CI quét lỗ hổng mỗi PR và hằng tuần, quyền tối thiểu, ngoại lệ có hạn (BASE-DEP-004)", () => {
    const w = read(".github/workflows/dep-audit.yml");
    expect(w).toMatch(/pull_request:/);
    expect(w).toMatch(/schedule:/);
    expect(w).toMatch(/npm ci/);
    expect(w).toMatch(/npm audit --audit-level=high/);
    expect(w).toMatch(/permissions:\s*\n\s+contents: read/);
    // mọi ngoại lệ ghi bảng phải còn hạn
    const today = new Date().toISOString().slice(0, 10);
    const dates = read("docs/ops-notes/dependency-exceptions.md").match(
      /\d{4}-\d{2}-\d{2}(?=\s*\|\s*$)/gm,
    );
    expect(dates?.length).toBeGreaterThan(0);
    for (const d of dates ?? [])
      expect(d > today, `ngoại lệ quá hạn ${d}`).toBe(true);
  });

  it("Dependabot theo dõi npm và GitHub Actions, có cooldown (BASE-DEP-007)", () => {
    const y = read(".github/dependabot.yml");
    expect(y).toMatch(/package-ecosystem:\s*npm/);
    expect(y).toMatch(/package-ecosystem:\s*github-actions/);
    expect(y.match(/cooldown:/g)?.length).toBeGreaterThanOrEqual(2);
    expect(
      y.match(/open-pull-requests-limit:/g)?.length,
    ).toBeGreaterThanOrEqual(2);
  });
});
