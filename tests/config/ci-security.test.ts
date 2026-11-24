import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * MUST nhóm chuỗi cung ứng và CI (T-515): mỗi `it` nêu ID nó giữ. Blueprint tick kèm
 * `— Kiểm: npx vitest run tests/config/ci-security.test.ts`.
 */
const read = (f: string) => readFileSync(f, "utf-8");
const wfDir = ".github/workflows";
const workflows = readdirSync(wfDir)
  .filter((f) => f.endsWith(".yml"))
  .map((f) => ({ file: f, text: read(`${wfDir}/${f}`) }));
const lines = (text: string) => text.split("\n");

describe("GitHub Actions an toàn (WF-CI, SEC-SUPPLY)", () => {
  it("WF-CI-001: job `quality` gom mọi cổng (needs gate, e2e; luôn chạy); ruleset đòi đúng quality + gitleaks", () => {
    const ci = read(`${wfDir}/ci.yml`);
    const quality = ci.slice(ci.indexOf("\n  quality:"));
    expect(quality).toMatch(/needs: \[gate, e2e\]/);
    expect(quality).toMatch(/always\(\)/);
    const rs = JSON.parse(read(".github/rulesets/main.json")) as {
      rules: {
        type: string;
        parameters?: { required_status_checks?: { context: string }[] };
      }[];
    };
    const checks = rs.rules
      .find((r) => r.type === "required_status_checks")!
      .parameters!.required_status_checks!.map((c) => c.context)
      .sort();
    expect(checks).toEqual(["gitleaks", "quality"]);
  });

  it("WF-CI-003: mọi workflow khai `permissions:` ở cấp workflow; không write-all", () => {
    for (const w of workflows) {
      expect(w.text, w.file).toMatch(/^permissions:/m);
      expect(w.text, w.file).not.toMatch(/permissions:\s*write-all/);
    }
  });

  it("WF-CI-004: input không tin cậy chỉ đi qua env:, không nội suy vào run:/script", () => {
    const untrusted =
      /\$\{\{\s*(github\.event\.(pull_request\.(title|body|head\.ref|head\.label)|issue\.(title|body)|comment\.body|review\.body|head_commit\.message)|github\.head_ref)\s*\}\}/;
    const offenders = workflows.flatMap((w) =>
      lines(w.text)
        .filter((l) => untrusted.test(l))
        // Cho phép: gán biến môi trường `NAME: ${{ … }}` (đưa qua env rồi quote trong shell).
        .filter((l) => !/^\s*-?\s*[A-Z][A-Z0-9_]*:\s*\$\{\{/.test(l))
        .map((l) => `${w.file}: ${l.trim()}`),
    );
    expect(offenders).toEqual([]);
  });

  it("WF-CI-005, SEC-SUPPLY-001: mọi `uses:` bên ngoài ghim SHA 40 ký tự kèm comment phiên bản", () => {
    const bad = workflows.flatMap((w) =>
      lines(w.text)
        .filter((l) => /^\s*-?\s*uses:\s/.test(l))
        .filter((l) => !/uses:\s*\.\//.test(l))
        .filter(
          (l) => !/uses:\s*[\w.-]+\/[\w./-]+@[0-9a-f]{40}\s+#\s*v?\d/.test(l),
        )
        .map((l) => `${w.file}: ${l.trim()}`),
    );
    expect(bad).toEqual([]);
    expect(read(".github/dependabot.yml")).toMatch(
      /package-ecosystem:\s*github-actions/,
    );
  });

  it("SEC-SUPPLY-009, LOOP-CI-008: không pull_request_target; workflow chạy theo comment/workflow_run kiểm author_association và không checkout code PR", () => {
    for (const w of workflows) {
      expect(w.text, w.file).not.toMatch(/^\s*pull_request_target:/m);
      if (/^\s*issue_comment:/m.test(w.text))
        expect(w.text, w.file).toMatch(/author_association/);
      if (/^\s*(issue_comment|workflow_run):/m.test(w.text))
        expect(w.text, w.file).not.toMatch(/ref:\s*\$\{\{[^}]*head/);
    }
    // Không workflow nào chạy action agent (không có điểm vào cho prompt từ PR/issue).
    for (const w of workflows)
      expect(w.text, w.file).not.toMatch(/uses:\s*anthropics\//);
  });

  it("SEC-SUPPLY-003: cài bằng npm ci (khoá lockfile) và CI đỏ nếu lockfile đổi sau cài", () => {
    expect(read("xt.yaml")).toMatch(/^setup: "npm ci"/m);
    expect(read(`${wfDir}/ci.yml`)).toMatch(
      /git diff --exit-code -- package-lock\.json/,
    );
  });

  it("BASE-DEP-008: image nền, compose và binary tải về ghim digest/checksum; action ghim SHA", () => {
    const from = lines(read("Dockerfile")).filter((l) => /^FROM /.test(l));
    expect(from.length).toBeGreaterThan(0);
    for (const l of from) expect(l).toMatch(/@sha256:[0-9a-f]{64}/);
    for (const l of lines(read("docker-compose.yml")).filter((l) =>
      /^\s*image:/.test(l),
    ))
      expect(l).toMatch(/@sha256:[0-9a-f]{64}/);
    expect(read(`${wfDir}/secret-scan.yml`)).toMatch(/sha256sum --check/);
  });

  it("SEC-SUPPLY-006: quét lỗ hổng phụ thuộc trên mỗi PR và theo lịch tuần; ngoại lệ có lý do và hạn", () => {
    const w = read(`${wfDir}/dep-audit.yml`);
    expect(w).toMatch(/pull_request/);
    expect(w).toMatch(/schedule:/);
    expect(w).toMatch(/audit-level=high|audit:deps/);
    expect(read("docs/ops-notes/dependency-exceptions.md")).toMatch(
      /\d{4}-\d{2}-\d{2}/,
    );
  });
});

describe("bảo trì phụ thuộc (OPS-MAINT, BASE-DEP-006)", () => {
  it("OPS-MAINT-001: Dependabot có mọi hệ sinh thái ứng với manifest (npm, docker, github-actions), lịch tuần, nhóm và trần PR", () => {
    const d = read(".github/dependabot.yml");
    const want = [
      ["package.json", "npm"],
      ["Dockerfile", "docker"],
      [`${wfDir}/ci.yml`, "github-actions"],
    ] as const;
    for (const [manifest, eco] of want) {
      expect(existsSync(manifest), manifest).toBe(true);
      expect(d, eco).toMatch(new RegExp(`package-ecosystem:\\s*${eco}`));
    }
    const blocks = d.split(/^\s*- package-ecosystem:/m).slice(1);
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    for (const b of blocks) {
      expect(b).toMatch(/interval:\s*weekly/);
      expect(b).toMatch(/open-pull-requests-limit:\s*\d+/);
      expect(b).toMatch(/groups:/);
    }
  });

  it("OPS-MAINT-005: có mẫu PR major-upgrade với các mục bắt buộc", () => {
    const t = read(".github/PULL_REQUEST_TEMPLATE/major-upgrade.md");
    for (const h of [
      "## Changelog và hướng dẫn nâng cấp đã đọc",
      "## Rủi ro và đường lùi",
      "## Bằng chứng",
      "## Phụ thuộc mới",
    ])
      expect(t).toContain(h);
    expect(t).toMatch(/nhãn `major`/);
  });

  it("BASE-DEP-006: mẫu PR có mục Phụ thuộc mới và pr-policy so lockfile với mục đó", () => {
    expect(read(".github/pull_request_template.md")).toMatch(
      /^## Phụ thuộc mới/m,
    );
    const w = read(`${wfDir}/pr-policy.yml`);
    expect(w).toMatch(/BASE-DEP-006/);
    expect(w).toMatch(/package-lock\.json/);
  });
});

describe("kỷ luật cổng (LOOP-CI-001, LOOP-CI-004)", () => {
  it("LOOP-CI-001: ngưỡng coverage không bị hạ (≥ 80); lý do cho tắt rule và skip/only do gates.test.ts và static-analysis.test.ts giữ", () => {
    const cfg = read("vitest.config.mts");
    for (const k of ["lines", "functions", "branches", "statements"]) {
      const m = new RegExp(`${k}:\\s*(\\d+)`).exec(cfg);
      expect(Number(m?.[1]), k).toBeGreaterThanOrEqual(80);
    }
    expect(existsSync("tests/config/gates.test.ts")).toBe(true);
    expect(existsSync("tests/config/static-analysis.test.ts")).toBe(true);
  });

  it("LOOP-CI-004: guard chặn force-push; ruleset chặn force-push; lịch sử gần đây không có commit rỗng", () => {
    const out = execFileSync("bash", [".claude/hooks/pre-bash-guard.sh"], {
      encoding: "utf-8",
      input: JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "git push --force origin main" },
      }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: process.cwd() },
    });
    expect(JSON.parse(out).hookSpecificOutput.permissionDecision).toBe("deny");
    expect(read(".github/rulesets/main.json")).toMatch(/non_fast_forward/);
    const log = execFileSync(
      "git",
      ["log", "--no-merges", "-n", "300", "--name-only", "--format=@%H"],
      { encoding: "utf-8" },
    );
    const empty = log
      .split("@")
      .filter(Boolean)
      .filter((c) =>
        c
          .split("\n")
          .slice(1)
          .every((l) => l.trim() === ""),
      )
      .map((c) => c.split("\n")[0]);
    expect(empty).toEqual([]);
  });
});
