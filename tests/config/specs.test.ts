import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  acBlocks,
  decisionIds,
  edgeCoverage,
  frontmatter,
  lintSpec,
  missingTraces,
} from "./spec-lint";

/**
 * Spec là hợp đồng (T-560): WF-SDD-001/002/003, PM-SPEC-001/003/004/020. Quy ước ở `docs/specs/README.md`.
 * Blueprint tick kèm `— Kiểm: npx vitest run tests/config/specs.test.ts`.
 */
const read = (f: string) => readFileSync(f, "utf-8");
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const SELF = new Set([
  "tests/config/specs.test.ts",
  "tests/config/spec-lint.ts",
]);
const decisions = decisionIds(read("docs/autopilot/DECISIONS.md"));
const mustRows = [
  ...read("PROJECT.md").matchAll(
    /^\| (?:Must|Should)\s+\| (F-\d{3})\s+\|.*\| `([^`]+)`\s*\|$/gm,
  ),
].map((m) => ({ id: m[1]!, file: m[2]! }));
const specFiles = readdirSync("docs/specs")
  .filter((f) => /^F-\d{3}-.+\.md$/.test(f))
  .map((f) => `docs/specs/${f}`);
// Bản thân bộ kiểm không được tính là "test trỏ về AC".
const corpus = [...walk("tests"), ...walk("e2e")]
  .filter((f) => /\.ts$/.test(f) && !SELF.has(f))
  .map(read);

describe("mỗi F-NNN của PROJECT.md có spec Approved (PM-SPEC-001, WF-SDD-001)", () => {
  it("bảng MoSCoW có ≥ 5 dòng Must/Should và khớp đúng tập file docs/specs/F-*.md", () => {
    expect(mustRows.length).toBeGreaterThanOrEqual(5);
    expect(mustRows.map((r) => r.file).sort()).toEqual([...specFiles].sort());
  });

  it.each(mustRows)(
    "$id: file tồn tại, dòng Trạng thái: Approved, frontmatter feature khớp",
    ({ id, file }) => {
      expect(existsSync(file), file).toBe(true);
      const md = read(file);
      expect(md).toMatch(/^Trạng thái: Approved/m);
      expect(frontmatter(md)?.feature).toBe(id);
      expect(file).toContain(`/${id}-`);
    },
  );
});

describe.each(specFiles)("%s", (file) => {
  const md = read(file);
  const feature = frontmatter(md)?.feature ?? "?";

  it("lint đạt: frontmatter, AC Given/When/Then + ca lỗi, Ca biên ≥ 6/8 nhóm, Câu hỏi mở có D-NNN thật (WF-SDD-001/002, PM-SPEC-003/020)", () => {
    expect(lintSpec(md, decisions)).toEqual([]);
  });

  it("mỗi AC có ít nhất một test dưới tests/ hoặc e2e/ chứa `F-NNN/AC-xx` (WF-SDD-003, PM-SPEC-004)", () => {
    const ids = acBlocks(md).map((a) => a.id);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    expect(missingTraces(feature, ids, corpus)).toEqual([]);
  });
});

/** Spec mẫu hợp lệ (tính năng giả F-900) để test âm: mỗi test làm hỏng đúng một điểm. */
function fixture(
  over: Partial<
    Record<"fm" | "status" | "ac" | "edge" | "questions", string>
  > = {},
) {
  const edgeRows = [
    "| Rỗng/null | rỗng | từ chối | AC-01 |",
    "| Cực đại/độ dài | dài | từ chối | AC-01 |",
    "| Trùng lặp/idempotency | gửi lại | một bản | AC-01 |",
    "| Song song | hai phiên | một bản | AC-01 |",
    "| Mất mạng giữa chừng | đứt | báo lỗi | AC-02 |",
    "| Thời gian/múi giờ | — | không áp dụng — không có thời gian | — |",
    "| Quyền | người ngoài | 403 | AC-02 |",
    "| Tiền/đơn vị | — | không áp dụng — không có tiền | — |",
  ].join("\n");
  return [
    over.fm ??
      "---\nstatus: approved\napproved_by: phiên chính\napproved_at: 2026-11-24\nfeature: F-900\n---\n",
    "# SPEC F-900 — mẫu\n",
    over.status ?? "Trạng thái: Approved for implementation\n",
    "## 2. Tiêu chí chấp nhận\n",
    over.ac ??
      "### AC-01 — Đường chính\n\n- Given a\n- When b\n- Then c\n\n### AC-02 — Từ chối (ca lỗi)\n\n- Given a\n- When b\n- Then c\n",
    "## 3. Ca biên\n",
    "| Nhóm | Ca cụ thể | Hành vi mong đợi | AC |\n| --- | --- | --- | --- |",
    over.edge ?? edgeRows,
    "\n## 10. Câu hỏi mở\n",
    over.questions ??
      "- [x] Hở? — [không chặn] — Đã quyết: D-001 (phiên chính) — xong\n",
    "## 11. DoR / DoD\n",
  ].join("\n");
}
const D = new Set(["D-001"]);
const problems = (md: string) => lintSpec(md, D).join("\n");

describe("bộ lint tự bắt spec hỏng (test âm)", () => {
  it("spec mẫu hợp lệ thì đạt (đối chứng)", () => {
    expect(lintSpec(fixture(), D)).toEqual([]);
    expect(edgeCoverage(fixture()).covered).toHaveLength(8);
  });

  it("thiếu frontmatter hoặc thiếu approved_by/approved_at → đỏ", () => {
    expect(problems(fixture({ fm: "" }))).toMatch(/thiếu frontmatter/);
    const noBy = "---\nstatus: approved\napproved_at: 2026-11-24\n---\n";
    expect(problems(fixture({ fm: noBy }))).toMatch(/thiếu approved_by/);
    const badDate =
      "---\nstatus: approved\napproved_by: x\napproved_at: 24/11/2026\n---\n";
    expect(problems(fixture({ fm: badDate }))).toMatch(/YYYY-MM-DD/);
  });

  it("status draft hoặc thiếu dòng Trạng thái: Approved → đỏ", () => {
    const draft =
      "---\nstatus: draft\napproved_by: x\napproved_at: 2026-11-24\n---\n";
    expect(problems(fixture({ fm: draft }))).toMatch(/cần approved/);
    expect(problems(fixture({ status: "Trạng thái: Draft\n" }))).toMatch(
      /Trạng thái: Approved/,
    );
  });

  it("không có AC, AC thiếu Then, trùng ID hoặc không có ca lỗi → đỏ", () => {
    expect(problems(fixture({ ac: "Chỉ có văn xuôi.\n" }))).toMatch(
      /không có AC-xx/,
    );
    expect(
      problems(
        fixture({ ac: "### AC-01 — x (ca lỗi)\n\n- Given a\n- When b\n" }),
      ),
    ).toMatch(/AC-01 thiếu Then/);
    const dup =
      "### AC-01 — a (ca lỗi)\n- Given a\n- When b\n- Then c\n### AC-01 — b\n- Given a\n- When b\n- Then c\n";
    expect(problems(fixture({ ac: dup }))).toMatch(/trùng ID AC/);
    expect(
      problems(
        fixture({
          ac: "### AC-01 — Đường chính\n\n- Given a\n- When b\n- Then c\n",
        }),
      ),
    ).toMatch(/ca lỗi/);
  });

  it("Ca biên chỉ phủ 5/8 nhóm, hoặc 'không áp dụng' thiếu lý do → đỏ", () => {
    const five = [
      "| Rỗng/null | x | y | AC-01 |",
      "| Cực đại/độ dài | x | y | AC-01 |",
      "| Song song | x | y | AC-01 |",
      "| Quyền | x | y | AC-02 |",
      "| Tiền/đơn vị | — | không áp dụng — không có tiền | — |",
      "| Thời gian/múi giờ | — | không áp dụng | — |",
      "| Mất mạng giữa chừng | x | y | — |",
    ].join("\n");
    expect(edgeCoverage(fixture({ edge: five })).covered).toHaveLength(5);
    expect(problems(fixture({ edge: five }))).toMatch(/phủ 5\/8 nhóm/);
  });

  it("câu hỏi đã đóng thiếu D-NNN, D-NNN không có trong DECISIONS, câu chặn còn mở, mục rỗng → đỏ", () => {
    expect(problems(fixture({ questions: "- [x] Hở? — đã xong\n" }))).toMatch(
      /thiếu 'Đã quyết: D-NNN'/,
    );
    expect(
      problems(fixture({ questions: "- [x] Hở? — Đã quyết: D-999 — x\n" })),
    ).toMatch(/D-999 không có/);
    expect(problems(fixture({ questions: "- [ ] Hở? — [chặn]\n" }))).toMatch(
      /câu hỏi chặn còn mở/,
    );
    expect(problems(fixture({ questions: "\n" }))).toMatch(/Câu hỏi mở/);
    expect(lintSpec(fixture({ questions: "Không có.\n" }), D)).toEqual([]);
  });

  it("AC không có test nào chứa `F-NNN/AC-xx` thì bị liệt kê; ID khác tính năng không được tính", () => {
    const tests = [
      'it("a [F-900/AC-01]", () => {})',
      'it("b [F-901/AC-02]", () => {})',
    ];
    expect(missingTraces("F-900", ["AC-01", "AC-02"], tests)).toEqual([
      "AC-02",
    ]);
  });

  it("decisionIds chỉ lấy heading `### D-NNN`, không lấy chữ D-NNN nhắc trong văn xuôi", () => {
    const ids = decisionIds("### D-001 · x\nthay D-002\n### D-003 · y\n");
    expect([...ids]).toEqual(["D-001", "D-003"]);
  });
});
