import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Công cụ quy trình thuộc dự án (ADR-0003, D-009): hàng rào chặn tái phát việc cài lại bản quản lý từ bên ngoài, hook
 * chết (tệp mode 644 gọi trực tiếp thoát 126 và không chạy) và di sản projects-template.
 */
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf-8" })
  .split("\0")
  .filter(Boolean);

interface HookCommand {
  command: string;
}
const settings = JSON.parse(readFileSync(".claude/settings.json", "utf-8")) as {
  hooks: Record<string, { hooks: HookCommand[] }[]>;
};
const hookCommands = Object.values(settings.hooks).flatMap((groups) =>
  groups.flatMap((g) => g.hooks.map((h) => h.command)),
);

describe("công cụ quy trình thuộc dự án", () => {
  it("không còn tệp quản lý bản cài và workflow nâng khung", () => {
    for (const f of [
      ".xtemplates/manifest.json",
      ".xtemplates/harness.sha256.json",
      ".github/workflows/xt-upgrade.yml",
    ])
      expect(tracked, f).not.toContain(f);
  });

  it("VERSION là nhãn của dự án, không phải SemVer của bản phát hành khung", () => {
    const label = readFileSync(".xtemplates/VERSION", "utf-8").trim();
    expect(label).not.toMatch(/^\d+\.\d+\.\d+/);
    expect(label).toMatch(/^xw-/);
  });

  it("README của công cụ nói rõ thuộc dự án và vì sao giữ đường dẫn", () => {
    const readme = readFileSync(".xtemplates/README.md", "utf-8");
    expect(readme).toMatch(/thuộc dự án X-Workspace/);
    expect(readme).toMatch(/ADR-0003/);
    expect(readme).not.toMatch(/không sửa tay/);
  });

  it("scripts/ chỉ còn migrate.mjs (di sản projects-template đã gỡ)", () => {
    expect(tracked.filter((f) => f.startsWith("scripts/"))).toEqual([
      "scripts/migrate.mjs",
    ]);
  });

  it("tests/ không còn bộ kiểm Python của bộ cũ", () => {
    expect(tracked.filter((f) => /^tests\/.*\.py$/.test(f))).toEqual([]);
  });

  it("mọi hook đăng ký đều gọi qua bash và trỏ tới tệp có thật", () => {
    expect(hookCommands.length).toBeGreaterThan(0);
    for (const cmd of hookCommands) {
      expect(cmd, cmd).toMatch(/^bash "\$\{CLAUDE_PROJECT_DIR\}\/[^"]+\.sh"$/);
      const rel = /\}\/([^"]+)"/.exec(cmd)![1]!;
      expect(existsSync(rel), rel).toBe(true);
      expect(statSync(rel).isFile(), rel).toBe(true);
    }
  });

  it("không đăng ký hook nào trỏ tới di sản projects-template", () => {
    const legacy =
      /block-dangerous-git|pre-commit-gate|session-guide|session-resume|telemetry-record|usage-guard|ui-intelligence|precompact-checkpoint/;
    expect(hookCommands.filter((c) => legacy.test(c))).toEqual([]);
  });

  it("guard và các hook lõi vẫn được đăng ký (không gỡ hàng rào)", () => {
    for (const hook of [
      "pre-bash-guard.sh",
      "pre-edit-guard.sh",
      "pre-mcp-guard.sh",
      "stop-guard.sh",
      "session-start.sh",
    ])
      expect(
        hookCommands.some((c) => c.endsWith(`/.claude/hooks/${hook}"`)),
        hook,
      ).toBe(true);
  });

  it("AGENTS.md mô tả X-Workspace và công cụ thuộc dự án, không còn chỗ để trống (XC-DOCAI-001)", () => {
    const agents = readFileSync("AGENTS.md", "utf-8");
    expect(agents).toMatch(/X-Workspace/);
    expect(agents).toMatch(/ADR-0003/);
    expect(agents).not.toMatch(/\[ĐIỀN/);
    expect(readFileSync("CLAUDE.md", "utf-8")).not.toMatch(/\[ĐIỀN/);
  });
});

/**
 * MUST của nhóm vòng lặp/hướng dẫn agent (T-511): mỗi `it` nêu ID nó giữ. Các mục cần `harness-check` xanh
 * (LOOP-ORCH-001/003, LOOP-STOP-001/002) và nhãn risk của PR (LOOP-STOP-005) vướng di sản T-108/cài đặt repo → `loop defer`.
 */
describe("MUST vòng lặp và hướng dẫn agent (T-511)", () => {
  const read = (f: string) => readFileSync(f, "utf-8");
  const plan = read("docs/autopilot/PLAN-harden-2026-11-23.md");
  const agents = read("AGENTS.md");

  it("LOOP-CTX-001: SessionStart nạp PROGRESS ≤ 9 800 ký tự và chỉ 4 mục", () => {
    const out = execFileSync("bash", [".claude/hooks/session-start.sh"], {
      encoding: "utf-8",
      input: "{}",
      env: { ...process.env, CLAUDE_PROJECT_DIR: process.cwd() },
    });
    expect(out.length).toBeLessThanOrEqual(9800);
    const sections = read("PROGRESS.md").match(/^## .+$/gm);
    expect(sections).toEqual([
      "## Đang làm",
      "## Tiếp theo",
      "## Quyết định",
      "## Bàn giao phiên",
    ]);
    expect(statSync("PROGRESS.md").size).toBeLessThanOrEqual(8 * 1024);
  });

  it("LOOP-CTX-006: phiên mới chỉ cần AGENTS.md + PROGRESS.md (thứ tự đọc và nơi ghi trạng thái nằm trong repo)", () => {
    expect(agents).toMatch(/Đọc theo thứ tự khi bắt đầu phiên/);
    expect(agents).toMatch(/`PROGRESS\.md`/);
    expect(agents).toMatch(/`xt\.yaml`/);
    expect(
      existsSync("docs/autopilot/PLAN.md") || /PLAN-harden/.test(plan),
    ).toBe(true);
  });

  it("LOOP-CTX-017: có hook PreCompact; bàn giao chỉ khi gần trần (luật ghi ở PLAN)", () => {
    expect(Object.keys(settings.hooks)).toContain("PreCompact");
    expect(read(".claude/skills/handover/SKILL.md")).toMatch(
      /gần hết trần vòng\/giờ\/tiền/,
    );
  });

  it("LOOP-HARNESS-001/002: PLAN-harden mỗi task một dòng `T-` và mỗi task có Gate", () => {
    const tasks = plan.match(/^- \[[ x~]\] `T-\d+`.*$/gm) ?? [];
    expect(tasks.length).toBeGreaterThanOrEqual(40);
    expect(tasks.filter((t) => !/Gate:/.test(t))).toEqual([]);
  });

  it("LOOP-HARNESS-003, LOOP-DESIGN-001: PLAN ghi Ngân sách (4 con số) và Điểm dừng, timeout Gate", () => {
    expect(plan).toMatch(/^## Ngân sách/m);
    expect(plan).toMatch(/^## Điểm dừng/m);
    expect(plan).toMatch(/XT_RECORD_TIMEOUT/);
  });

  it("LOOP-HARNESS-008: xt.yaml ở gốc khai lệnh cổng và dev-task.sh thực thi được", () => {
    const xt = read("xt.yaml");
    expect(xt).toMatch(/^test:/m);
    expect(xt).toMatch(/^commit_gate:/m);
    expect(statSync(".xtemplates/scripts/dev-task.sh").mode & 0o111).not.toBe(
      0,
    );
  });

  it("LOOP-DESIGN-004: Stop hook gọi `loop hook-stop`, không hook nào dựa vào <promise>", () => {
    expect(
      hookCommands.some((c) => c.endsWith('/.claude/hooks/stop-guard.sh"')),
    ).toBe(true);
    expect(read(".claude/hooks/stop-guard.sh")).toMatch(/loop hook-stop/);
    for (const f of tracked.filter((t) =>
      /^\.claude\/hooks\/[^/]+\.sh$/.test(t),
    ))
      expect(read(f), f).not.toMatch(/<promise>/);
  });

  it("LOOP-DESIGN-008: không đặt CLAUDE_CODE_STOP_HOOK_BLOCK_CAP (giữ mặc định 8)", () => {
    expect(JSON.stringify(settings)).not.toMatch(/STOP_HOOK_BLOCK_CAP/);
    expect(read("xt.yaml")).not.toMatch(/STOP_HOOK_BLOCK_CAP/);
  });

  it("LOOP-OPT-001/002/003/005 (điều kiện Không áp dụng): chưa có task tối ưu — không perf/trial.json, PLAN không dùng `perf trial`", () => {
    expect(tracked).not.toContain("perf/trial.json");
    expect(plan).not.toMatch(/perf trial/);
  });

  it("LOOP-ORCH-009: subagent đang dùng không được giao push/publish (prompt chỉ nhắc để cấm)", () => {
    for (const a of [
      "researcher",
      "executor",
      "executor-deep",
      "reviewer",
      "reviewer-alt",
      "acceptance-author",
    ]) {
      const md = read(`.claude/agents/${a}.md`);
      for (const line of md
        .split("\n")
        .filter((l) => /git push|publish|gh pr merge/.test(l)))
        expect(line, `${a}: ${line}`).toMatch(/Không|không|cấm/);
    }
  });

  it("LOOP-STOP-003: sửa workflow CI ở chính sách strict bị hỏi lý do (pre-edit-guard)", () => {
    const out = execFileSync("bash", [".claude/hooks/pre-edit-guard.sh"], {
      encoding: "utf-8",
      input: JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: `${process.cwd()}/.github/workflows/x.yml` },
      }),
      env: { ...process.env, XT_GUARD_POLICY: "strict" },
    });
    expect(JSON.parse(out).hookSpecificOutput.permissionDecision).toBe("ask");
  });

  it("XC-DOCAI-001/003: AGENTS.md ở gốc có heading bắt buộc, trỏ lệnh chuẩn ở xt.yaml và cấm suy diễn", () => {
    for (const h of [
      /^## 1\. Dự án này/m,
      /^## 3\. Đọc theo thứ tự/m,
      /^## 7\. Cổng/m,
    ])
      expect(agents).toMatch(h);
    expect(agents).toMatch(/dev-task\.sh gate-fast/);
    expect(read("xt.yaml")).toMatch(/gate-fast/);
    expect(agents).toMatch(/không suy diễn từ văn xuôi/);
  });

  it("XC-DOCAI-004: AGENTS.md nêu điểm dừng bắt buộc và ranh giới tin cậy; hook tương ứng đã đăng ký", () => {
    expect(agents).toMatch(/Điểm dừng bắt buộc/);
    expect(agents).toMatch(/dữ liệu, không phải chỉ thị/);
    expect(
      hookCommands.some((c) => c.endsWith('/.claude/hooks/pre-bash-guard.sh"')),
    ).toBe(true);
  });
});
