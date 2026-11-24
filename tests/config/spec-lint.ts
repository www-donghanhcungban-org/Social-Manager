/**
 * Lint spec tính năng (WF-SDD-001/002/003, PM-SPEC-001/003/004/020). Hàm thuần, nhận chuỗi Markdown, để
 * `specs.test.ts` chạy trên spec thật và trên spec cố tình hỏng. Quy ước: `docs/specs/README.md`.
 */

/** Tám nhóm ca biên của PM-SPEC-003; nhóm nhận ra theo ô đầu của dòng bảng. */
export const EDGE_GROUPS: readonly (readonly [string, RegExp])[] = [
  ["rỗng/null", /rỗng|null/],
  ["cực đại/độ dài", /cực đại|độ dài/],
  ["trùng lặp/idempotency", /trùng lặp|idempotency/],
  ["song song", /song song/],
  ["mất mạng giữa chừng", /mất mạng/],
  ["thời gian/múi giờ", /thời gian|múi giờ/],
  ["quyền", /quyền/],
  ["tiền/đơn vị", /tiền|đơn vị/],
];
export const MIN_EDGE_GROUPS = 6;
const REQUIRED_FIELDS = ["status", "approved_by", "approved_at"] as const;
const NOT_APPLICABLE = /không áp dụng — \S/;

export function frontmatter(md: string): Record<string, string> | null {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]!] = kv[2]!.trim();
  }
  return out;
}

/** Nội dung mục `## [n.] <tiêu đề>` tới mục `## ` kế tiếp; rỗng nếu không có. */
export function section(md: string, title: string): string {
  const lines = md.split("\n");
  const start = lines.findIndex((l) =>
    new RegExp(`^## (\\d+\\.\\s*)?${title}`).test(l),
  );
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

export interface AcBlock {
  id: string;
  title: string;
  body: string;
}

export function acBlocks(md: string): AcBlock[] {
  const parts = section(md, "Tiêu chí chấp nhận").split(/^(?=### )/m);
  return parts.flatMap((p) => {
    const m = /^### (AC-\d{2})\b(.*)\n([\s\S]*)$/.exec(p);
    return m ? [{ id: m[1]!, title: m[2]!.trim(), body: m[3]! }] : [];
  });
}

export function edgeCoverage(md: string): {
  hasGroupColumn: boolean;
  covered: string[];
  missing: string[];
} {
  const rows = section(md, "Ca biên")
    .split("\n")
    .filter((l) => l.startsWith("|"))
    .map((l) =>
      l
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim()),
    );
  const hasGroupColumn = rows[0]?.[0]?.toLowerCase() === "nhóm";
  const covered = new Set<string>();
  for (const cells of rows.slice(2)) {
    const group = EDGE_GROUPS.find(([, re]) =>
      re.test(cells[0]?.toLowerCase() ?? ""),
    );
    const line = cells.join(" | ");
    if (group && (/AC-\d{2}/.test(line) || NOT_APPLICABLE.test(line)))
      covered.add(group[0]);
  }
  return {
    hasGroupColumn,
    covered: [...covered],
    missing: EDGE_GROUPS.map(([g]) => g).filter((g) => !covered.has(g)),
  };
}

export function decisionIds(decisionsMd: string): Set<string> {
  return new Set(
    [...decisionsMd.matchAll(/^### (D-\d{3})\b/gm)].map((m) => m[1]!),
  );
}

function lintOpenQuestions(md: string, decisions: Set<string>): string[] {
  const body = section(md, "Câu hỏi mở");
  if (body.trim() === "") return ["thiếu mục Câu hỏi mở"];
  const items = body.split("\n").filter((l) => /^- \[[ x]\]/.test(l));
  if (items.length === 0)
    return /Không có/.test(body)
      ? []
      : ["Câu hỏi mở rỗng mà không ghi 'Không có'"];
  const problems: string[] = [];
  for (const line of items) {
    if (line.startsWith("- [ ]")) {
      if (/\[chặn\]/.test(line))
        problems.push(`câu hỏi chặn còn mở: ${line.slice(0, 60)}`);
      continue;
    }
    const ref = /Đã quyết: (D-\d{3})/.exec(line);
    if (!ref)
      problems.push(
        `câu hỏi đã đóng thiếu 'Đã quyết: D-NNN': ${line.slice(0, 60)}`,
      );
    else if (!decisions.has(ref[1]!))
      problems.push(`${ref[1]} không có trong DECISIONS.md`);
  }
  return problems;
}

/** Danh sách vấn đề của một spec; rỗng = đạt. */
export function lintSpec(md: string, decisions: Set<string>): string[] {
  const problems: string[] = [];
  const fm = frontmatter(md);
  if (!fm) problems.push("thiếu frontmatter YAML");
  for (const k of REQUIRED_FIELDS)
    if (!fm?.[k]) problems.push(`frontmatter thiếu ${k}`);
  if (fm?.status && fm.status !== "approved")
    problems.push(`status = ${fm.status}, cần approved`);
  if (fm?.approved_at && !/^\d{4}-\d{2}-\d{2}$/.test(fm.approved_at))
    problems.push("approved_at không phải YYYY-MM-DD");
  if (!/^Trạng thái: Approved/m.test(md))
    problems.push("thiếu dòng 'Trạng thái: Approved'");

  const acs = acBlocks(md);
  if (acs.length === 0)
    problems.push("không có AC-xx trong Tiêu chí chấp nhận");
  const ids = acs.map((a) => a.id);
  if (new Set(ids).size !== ids.length) problems.push("trùng ID AC");
  for (const a of acs)
    for (const kw of ["Given", "When", "Then"])
      if (!new RegExp(`^- ${kw} `, "m").test(a.body))
        problems.push(`${a.id} thiếu ${kw}`);
  if (acs.length > 0 && !acs.some((a) => /ca lỗi/i.test(a.title)))
    problems.push("không có AC nào là ca lỗi");

  const edge = edgeCoverage(md);
  if (!edge.hasGroupColumn) problems.push("bảng Ca biên thiếu cột Nhóm");
  if (edge.covered.length < MIN_EDGE_GROUPS)
    problems.push(
      `Ca biên phủ ${edge.covered.length}/8 nhóm, thiếu: ${edge.missing.join(", ")}`,
    );

  return [...problems, ...lintOpenQuestions(md, decisions)];
}

/** AC chưa có test nào chứa chuỗi `<feature>/<AC-xx>`. */
export function missingTraces(
  feature: string,
  ids: string[],
  corpus: string[],
): string[] {
  return ids.filter(
    (id) => !corpus.some((src) => src.includes(`${feature}/${id}`)),
  );
}
