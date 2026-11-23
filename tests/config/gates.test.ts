import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf-8");
const pkg = JSON.parse(read("package.json")) as {
  scripts: Record<string, string>;
};
const tracked = () =>
  execFileSync("git", ["ls-files", "-z"], { encoding: "utf-8" })
    .split("\0")
    .filter(Boolean);

describe("năm lệnh chuẩn (BASE-GATE-001)", () => {
  const xt = read("xt.yaml");
  it.each([
    ["format", "format"],
    ["lint", "lint"],
    ["typecheck", "type-check"],
    ["test", "test"],
    ["build", "build"],
  ])("`%s` có trong xt.yaml và trỏ tới script npm có thật", (key, script) => {
    const m = new RegExp(`^${key}:\\s*"npm (?:run )?${script}"`, "m").exec(xt);
    expect(m, `xt.yaml thiếu ${key}`).not.toBeNull();
    expect(
      pkg.scripts[script],
      `package.json thiếu script ${script}`,
    ).toBeTruthy();
  });
});

describe("cổng chất lượng nghiêm (BASE-GATE-003/004)", () => {
  it("lint coi cảnh báo là lỗi (--max-warnings 0)", () => {
    expect(pkg.scripts.lint).toMatch(/--max-warnings(=|\s+)0/);
  });

  it("không có eslint-disable/@ts-ignore nào thiếu lý do tại chỗ", () => {
    const hits = tracked()
      .filter(
        (f) =>
          /\.(ts|tsx|mts|mjs|js)$/.test(f) && !f.startsWith(".xtemplates/"),
      )
      .flatMap((f) =>
        read(f)
          .split("\n")
          .map((line, i) => ({ f, line, n: i + 1 }))
          .filter(
            ({ line }) =>
              /eslint-disable|@ts-ignore|@ts-nocheck|@ts-expect-error/.test(
                line,
              ) &&
              !/(--|—|:)\s*\S{6,}/.test(
                line.replace(/^.*?(eslint-disable[\w-]*|@ts-\w+[\w-]*)/, ""),
              ),
          )
          // chính file này nhắc các chuỗi trên làm ví dụ
          .filter(({ f }) => f !== "tests/config/gates.test.ts"),
      );
    expect(hits).toEqual([]);
  });

  it("TypeScript strict bật", () => {
    const ts = JSON.parse(read("tsconfig.json")) as {
      compilerOptions: { strict?: boolean };
    };
    expect(ts.compilerOptions.strict).toBe(true);
  });
});

describe("mã hoá UTF-8 (BASE-DATA-001)", () => {
  it(".editorconfig khai charset = utf-8", () => {
    expect(read(".editorconfig")).toMatch(/^charset\s*=\s*utf-8$/m);
  });

  it("mọi file văn bản trong git là UTF-8 hợp lệ, không BOM", () => {
    const textExt = /\.(ts|tsx|mts|mjs|js|json|md|css|sql|yml|yaml|txt|sh|py)$/;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const bad: string[] = [];
    for (const f of tracked().filter((f) => textExt.test(f))) {
      const buf = readFileSync(f);
      try {
        decoder.decode(buf);
      } catch {
        bad.push(`${f}: không phải UTF-8`);
      }
      if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf)
        bad.push(`${f}: có BOM`);
    }
    expect(bad).toEqual([]);
  });
});

describe("thời gian luôn có múi giờ (BASE-DATA-006)", () => {
  it("schema và migration không dùng `timestamp` không múi giờ", () => {
    const schema = read("src/db/schema.ts") + read("src/db/auth-schema.ts");
    // mọi lời gọi timestamp(...) phải kèm withTimezone: true
    const calls = schema.match(/timestamp\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c, c).toContain("withTimezone: true");

    const sql = tracked()
      .filter(
        (f) => /^drizzle\/\d+_.*\.sql$/.test(f) && !f.endsWith(".down.sql"),
      )
      .map(read)
      .join("\n");
    expect(sql).not.toMatch(/timestamp(?!\s+with time zone)\b(?!tz)/i);
  });

  it("mã ứng dụng không lưu/trao đổi thời điểm bằng chuỗi cục bộ (toString/toLocale*)", () => {
    const offenders = tracked()
      .filter((f) => /^(src|app)\/.*\.(ts|tsx)$/.test(f))
      .filter(
        (f) =>
          /\.toString\(\)|toLocale(Date|Time)?String/.test(read(f)) &&
          /new Date\([^)]*\)\.(toString|toLocale\w*)\(/.test(read(f)),
      );
    expect(offenders).toEqual([]);
  });
});

/**
 * MUST nhóm cổng/repo/tài liệu (T-513): mỗi `it` nêu ID nó giữ. Blueprint tick kèm
 * `— Kiểm: npx vitest run tests/config/gates.test.ts tests/config/repo-docs.test.ts`.
 */
describe("cổng, repo và quy ước commit (T-513)", () => {
  const ci = read(".github/workflows/ci.yml");
  const xt = read("xt.yaml");

  it("BASE-GATE-005: test chạy bằng một lệnh tất định, CI chạy toàn bộ và không bước nào được đỏ mà xanh", () => {
    expect(pkg.scripts.test).toMatch(/vitest run/);
    expect(xt).toMatch(/^test: "npm test"/m);
    expect(ci).toMatch(/dev-task\.sh gate-par/);
    expect(ci).not.toMatch(/continue-on-error:\s*true/);
    expect(pkg.scripts.test).not.toMatch(
      /--bail|--passWithNoTests|\|\|\s*true/,
    );
  });

  it("BASE-GATE-006: mọi cổng của commit_gate (format_check, lint, typecheck, test) được CI chạy lại", () => {
    expect(xt).toMatch(/^commit_gate: fast/m);
    for (const k of ["format_check", "lint", "typecheck", "test"])
      expect(xt, k).toMatch(new RegExp(`^${k}: "npm `, "m"));
    expect(ci).toMatch(/gate-par/); // typecheck ∥ lint ∥ build → test
    expect(ci).toMatch(/xt\.py floor --run/); // format_check, coverage
  });

  it("BASE-GATE-008: CI cài phụ thuộc đóng băng (npm ci) rồi build trên runner mới", () => {
    expect(xt).toMatch(/^setup: "npm ci"/m);
    expect(xt).toMatch(/^build: "npm run build"/m);
    expect(ci).toMatch(/runs-on: ubuntu-latest/);
    expect(ci).toMatch(/dev-task\.sh setup/);
    expect(tracked()).toContain("package-lock.json");
  });

  it("BASE-REPO-001: file cần để build đều đã commit (lockfile, Dockerfile, migration, cấu hình)", () => {
    const t = tracked();
    for (const f of [
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "next.config.mjs",
      "Dockerfile",
      "docker-compose.yml",
      "xt.yaml",
      "drizzle.config.ts",
    ])
      expect(t, f).toContain(f);
    expect(t.some((f) => /^drizzle\/\d+_.*\.sql$/.test(f))).toBe(true);
  });

  it("BASE-REPO-005, STD-PROC-004: Conventional Commits ≤ 100 ký tự được cưỡng chế ở tiêu đề PR (squash) và lúc đặt commit", () => {
    const wf = read(".github/workflows/pr-title.yml");
    expect(wf).toMatch(/feat\|fix\|docs/);
    expect(wf).toMatch(/-gt 100/);
    expect(read(".claude/hooks/guard.py")).toMatch(/LOOP-HARNESS-029/);
  });

  it("BASE-REPO-013: ruleset chặn force-push/xoá nhánh chính; quy ước rewrite ghi ở AGENTS.md", () => {
    const rs = read(".github/rulesets/main.json");
    expect(rs).toMatch(/"non_fast_forward"/);
    expect(rs).toMatch(/"deletion"/);
    expect(read("AGENTS.md")).toMatch(
      /không force-push, không rewrite history nhánh người khác/,
    );
  });

  it("WF-GIT-010: .gitignore đủ nhóm env/khoá/build/OS/IDE, không .env hay khoá trong git, quét bí mật toàn lịch sử ở CI", () => {
    const ig = read(".gitignore");
    for (const p of [
      "/node_modules",
      ".env*",
      "*.pem",
      "/.next/",
      "/coverage",
      ".DS_Store",
    ])
      expect(ig, p).toContain(p);
    const bad = tracked().filter(
      (f) =>
        (/(^|\/)\.env($|\.)/.test(f) && !/\.env\.example$/.test(f)) ||
        /\.(pem|key|p12|pfx)$/.test(f) ||
        /\.(dump|sql\.gz|bak)$/.test(f),
    );
    expect(bad).toEqual([]);
    const scan = read(".github/workflows/secret-scan.yml");
    expect(scan).toMatch(/fetch-depth:\s*0/);
    expect(scan).toMatch(/gitleaks/);
  });

  it("WF-DOC-001: mẫu PR có mục Docs cập nhật/không cần và pr-policy cảnh báo khi đổi cấu hình mà không chạm docs", () => {
    expect(read(".github/pull_request_template.md")).toMatch(/Docs cập nhật/);
    expect(read(".github/workflows/pr-policy.yml")).toMatch(/::warning::/);
  });
});
