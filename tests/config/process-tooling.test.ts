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
    expect(readme).toMatch(/thuộc dự án X-Working/);
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

  it("AGENTS.md mô tả X-Working và công cụ thuộc dự án, không còn chỗ để trống", () => {
    const agents = readFileSync("AGENTS.md", "utf-8");
    expect(agents).toMatch(/X-Working/);
    expect(agents).toMatch(/ADR-0003/);
    expect(agents).not.toMatch(/\[ĐIỀN/);
    expect(readFileSync("CLAUDE.md", "utf-8")).not.toMatch(/\[ĐIỀN/);
  });
});
