import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * MUST nhóm phân tích tĩnh, build và phiên bản công cụ (T-514): mỗi `it` nêu ID nó giữ. Blueprint tick kèm
 * `— Kiểm: npx vitest run tests/config/static-analysis.test.ts`.
 */
const read = (f: string) => readFileSync(f, "utf-8");
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf-8" })
  .split("\0")
  .filter(Boolean);
const pkg = JSON.parse(read("package.json")) as {
  engines?: { node?: string };
  packageManager?: string;
  scripts: Record<string, string>;
};
const tsconfig = JSON.parse(read("tsconfig.json")) as {
  compilerOptions: Record<string, unknown>;
};
const ci = read(".github/workflows/ci.yml");
const xt = read("xt.yaml");
const workflows = readdirSync(".github/workflows").filter((f) =>
  f.endsWith(".yml"),
);

describe("phiên bản công cụ ghim và build không giấu lỗi", () => {
  it("FE-BUILD-001: Node ghim (.nvmrc + engines), packageManager, đúng một lockfile, CI cài bằng npm ci", () => {
    const nvmrc = read(".nvmrc").trim();
    expect(nvmrc).toMatch(/^\d+(\.\d+){0,2}$/);
    const major = Number(nvmrc.split(".")[0]);
    expect(pkg.engines?.node).toMatch(/>=\d+ <\d+/);
    const [lo, hi] = [...pkg.engines!.node!.matchAll(/\d+/g)].map((m) =>
      Number(m[0]),
    );
    expect(major).toBeGreaterThanOrEqual(lo!);
    expect(major).toBeLessThan(hi!);
    expect(pkg.packageManager).toMatch(/^npm@\d+\.\d+\.\d+$/);
    expect(
      tracked.filter((f) =>
        /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(f),
      ),
    ).toEqual(["package-lock.json"]);
    expect(xt).toMatch(/^setup: "npm ci"/m);
    expect(read(".github/actions/xt-ci-tools/action.yml")).toMatch(
      /node-version-file:\s*\.nvmrc/,
    );
  });

  it("XC-DX-003: runtime ghim trong repo và CI không hard-code bản khác (Node theo .nvmrc, Python theo .python-version)", () => {
    const py = read(".python-version").trim();
    for (const f of workflows)
      for (const m of read(`.github/workflows/${f}`).matchAll(
        /python-version:\s*"?([\d.]+)"?/g,
      ))
        expect(m[1], f).toBe(py);
    for (const f of workflows)
      expect(read(`.github/workflows/${f}`), f).not.toMatch(
        /node-version:\s*"?\d/,
      );
  });

  it("FE-BUILD-003, PRF-WEB-002: build không bỏ qua lỗi (ignoreBuildErrors/ignoreDuringBuilds); CI chạy typecheck, lint và build", () => {
    const next = read("next.config.mjs");
    expect(next).not.toMatch(/ignoreBuildErrors|ignoreDuringBuilds/);
    expect(xt).toMatch(/^typecheck: "npm run type-check"/m);
    expect(xt).toMatch(/^lint: "npm run lint"/m);
    expect(xt).toMatch(/^build: "npm run build"/m);
    expect(ci).toMatch(/gate-par — typecheck ∥ lint ∥ build → test/);
    // skipLibCheck chỉ bỏ qua kiểm .d.ts của gói bên thứ ba (lỗi trong node_modules, không phải của dự án — D-022);
    // mã dự án luôn được kiểm ở chế độ strict.
    expect(tsconfig.compilerOptions.strict).toBe(true);
  });

  it("FE-BUILD-005: cấu hình đọc từ một module env có schema; ngoài đó chỉ NODE_ENV; không biến công khai NEXT_PUBLIC_", () => {
    const code = tracked.filter((f) =>
      /^(src|app)\/.*\.(ts|tsx)$|^(proxy|instrumentation)\.ts$/.test(f),
    );
    const offenders = code
      .filter((f) => f !== "src/config/env.ts")
      .flatMap((f) =>
        read(f)
          .split("\n")
          .filter((l) => /process\.env\.(?!NODE_ENV\b)/.test(l))
          .map((l) => `${f}: ${l.trim()}`),
      );
    expect(offenders).toEqual([]);
    expect(
      code.filter(
        (f) => f !== "src/config/env.ts" && /NEXT_PUBLIC_/.test(read(f)),
      ),
    ).toEqual([]);
    // Trong env.ts chỉ được nhắc tiền tố công khai ở comment (khẳng định "không có").
    expect(
      read("src/config/env.ts")
        .split("\n")
        .filter((l) => /NEXT_PUBLIC_/.test(l) && !/^\s*(\*|\/\/|\/\*)/.test(l)),
    ).toEqual([]);
    expect(existsSync("tests/config/startup.test.ts")).toBe(true);
  });
});

describe("lint, kiểu và test (QA-STATIC, QA-STRAT, BASE-DATA-003)", () => {
  it("QA-STATIC-001, QA-STRAT-001: lint và test là một lệnh khai ở xt.yaml và CI gọi đúng lệnh đó", () => {
    expect(pkg.scripts.lint).toMatch(/eslint .*--max-warnings 0/);
    expect(xt).toMatch(/^test: "npm test"/m);
    expect(ci).toMatch(/dev-task\.sh gate-par/);
    expect(ci).toMatch(/dev-task\.sh require lint test/);
  });

  it("QA-STATIC-003: TypeScript strict + noUncheckedIndexedAccess", () => {
    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(tsconfig.compilerOptions.noUncheckedIndexedAccess).toBe(true);
  });

  it("QA-STATIC-004, QA-STATIC-005, BASE-DATA-003: eslint hiệu lực có no-explicit-any, ban-ts-comment, no-console, prefer-nullish-coalescing", () => {
    const cfg = JSON.parse(
      execFileSync(
        "npx",
        ["eslint", "--print-config", "src/security/csrf.ts"],
        { encoding: "utf-8", maxBuffer: 20_000_000 },
      ),
    ) as { rules: Record<string, unknown[]> };
    const level = (r: string) => {
      const v = cfg.rules[r]?.[0];
      return v === 2 || v === "error";
    };
    for (const r of [
      "@typescript-eslint/no-explicit-any",
      "@typescript-eslint/ban-ts-comment",
      "no-console",
      "@typescript-eslint/prefer-nullish-coalescing",
    ])
      expect(level(r), r).toBe(true);
  });

  it("QA-STRAT-002: `quality` (required check) phụ thuộc cả gate và e2e, đỏ khi một job con đỏ; không continue-on-error", () => {
    const quality = ci.slice(ci.indexOf("\n  quality:"));
    expect(quality).toMatch(/needs: \[gate, e2e\]/);
    expect(quality).toMatch(/always\(\)/);
    expect(read(".github/rulesets/main.json")).toMatch(/"context": "quality"/);
    expect(ci).not.toMatch(/continue-on-error:\s*true/);
  });

  it("QA-STRAT-005: PR `fix:` không kèm test bị pr-policy cảnh báo", () => {
    const wf = read(".github/workflows/pr-policy.yml");
    expect(wf).toMatch(/fix/);
    expect(wf).toMatch(/::warning::.*test/);
  });

  it("QA-STRAT-008: Playwright forbidOnly ở CI; không `.only` hay skip không lý do trong test", () => {
    expect(read("playwright.config.ts")).toMatch(
      /forbidOnly:\s*!!process\.env\.CI/,
    );
    const specs = tracked.filter((f) => /^(tests|e2e)\/.*\.(ts|tsx)$/.test(f));
    const bad = specs.flatMap((f) =>
      read(f)
        .split("\n")
        .filter(
          (l) =>
            /\b(it|test|describe)\.only\(|\bfit\(|\bfdescribe\(|\bxit\(|\bxdescribe\(/.test(
              l,
            ) ||
            // skip tĩnh phải có lý do ở đối số sau (chuỗi), vd test.skip(cond, "lý do")
            /\b(it|test|describe)\.skip\(\s*["'`]/.test(l) ||
            /\b(it|test|describe)\.skip\(\s*[^,()]*\)\s*[;,]?\s*$/.test(l),
        )
        .map((l) => `${f}: ${l.trim()}`),
    );
    expect(bad).toEqual([]);
  });
});
