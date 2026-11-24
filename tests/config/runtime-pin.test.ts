import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf-8");
const pkg = JSON.parse(read("package.json")) as {
  engines?: { node?: string };
  packageManager?: string;
};

describe("runtime và package manager ghim trong repo (PRF-WEB-010, BASE-DEP-003)", () => {
  it(".nvmrc là bản LTS còn hỗ trợ (22, 24 hoặc 26)", () => {
    expect(existsSync(".nvmrc")).toBe(true);
    expect(read(".nvmrc").trim()).toMatch(/^(22|24|26)(\.\d+){0,2}$/);
  });

  it("engines.node chặn bản không hỗ trợ và chứa bản trong .nvmrc", () => {
    expect(pkg.engines?.node).toBe(">=22 <27");
    expect(Number(read(".nvmrc").trim().split(".")[0])).toBeGreaterThanOrEqual(
      22,
    );
  });

  it("packageManager ghim npm đúng phiên bản (có số bản)", () => {
    expect(pkg.packageManager).toMatch(/^npm@\d+\.\d+\.\d+$/);
  });

  it("CI cài Node từ .nvmrc bằng action ghim SHA, bật cache npm", () => {
    const action = read(".github/actions/xt-ci-tools/action.yml");
    expect(action).toMatch(/uses: actions\/setup-node@[0-9a-f]{40}/);
    expect(action).toContain("node-version-file: .nvmrc");
    expect(action).toContain("cache: npm");
    // ci.yml gọi action này ở cả job gate và e2e
    const ci = read(".github/workflows/ci.yml");
    expect(ci.match(/uses: \.\/\.github\/actions\/xt-ci-tools/g)).toHaveLength(
      2,
    );
  });
});
