import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * MUST nhóm quản lý dự án và quy trình (T-512): mỗi `it` nêu ID nó giữ. Blueprint tick kèm
 * `— Kiểm: npx vitest run tests/config/project-management.test.ts`.
 */
const read = (f: string) => readFileSync(f, "utf-8");
const project = read("PROJECT.md");
const risks = read("docs/RISKS.md");
const pr = read(".github/pull_request_template.md");

describe("PROJECT.md (PM-REQ, PM-PRIO, STD-PROC)", () => {
  it("PM-REQ-001: có phát biểu vấn đề không chứa tên công nghệ", () => {
    const m = /^## .*Vấn đề.*\n+- Vấn đề: (.+)$/m.exec(project);
    expect(m).not.toBeNull();
    expect(m![1]).not.toMatch(
      /Docker|Postgres|Next|React|API|webhook|AI\b|SocialAPI/i,
    );
  });

  it("PM-REQ-007: mỗi yêu cầu có ID R-NNN không trùng, liên tục từ R-001", () => {
    const ids = [...project.matchAll(/^\| (R-\d{3}) \|/gm)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe("R-001");
  });

  it("PM-REQ-019: không còn câu hỏi [chặn] chưa trả lời", () => {
    expect(project).not.toMatch(/\[chặn\]/i);
  });

  it("PM-PRIO-001: MoSCoW có Must mang ID F-NNN và spec tồn tại", () => {
    const rows = [
      ...project.matchAll(/^\| Must\s+\| (F-\d{3})\s+\|.*\| `([^`]+)`\s*\|$/gm),
    ];
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const [, id, spec] of rows) {
      expect(existsSync(spec!), `${id}: ${spec}`).toBe(true);
      expect(read(spec!), spec).toMatch(/Given [\s\S]* When [\s\S]* Then /);
    }
  });

  it("PM-PRIO-004: có SCOPE.md và PROJECT.md nêu phạm vi đóng băng đi qua SCOPE.md", () => {
    expect(existsSync("SCOPE.md")).toBe(true);
    expect(project).toMatch(/SCOPE\.md/);
    expect(read("SCOPE.md")).toMatch(/docs\(scope\)/);
  });

  it("PM-PRIO-007: không cổng nào bị tắt khi trễ hạn (CI không continue-on-error, không --no-verify)", () => {
    for (const f of [
      ".github/workflows/ci.yml",
      ".github/workflows/pr-policy.yml",
      ".github/workflows/pr-title.yml",
    ]) {
      expect(read(f), f).not.toMatch(/continue-on-error:\s*true|--no-verify/);
    }
    expect(read("SCOPE.md")).toMatch(/cắt Could\/Should trước/);
  });

  it("STD-PROC-001: bảng ISO/IEC 25010 có ≥ 3 đặc tính kèm ngưỡng số", () => {
    expect(project).toMatch(/25010/);
    const rows = project
      .split("\n")
      .filter((l) =>
        /^\| (Performance efficiency|Reliability|Security|Compatibility|Usability|Maintainability) /.test(
          l,
        ),
      );
    const withNumber = rows.filter((l) => /\d/.test(l.split("|")[2] ?? ""));
    expect(withNumber.length).toBeGreaterThanOrEqual(3);
  });
});

describe("kế hoạch (PM-PLAN)", () => {
  const plans = [
    "docs/autopilot/PLAN.md",
    "docs/autopilot/PLAN-harden-2026-11-23.md",
  ];

  it("PM-PLAN-001/003: mỗi task một dòng `T-NNN` có Gate, ID không trùng trong mỗi PLAN", () => {
    for (const f of plans) {
      const tasks = read(f).match(/^- \[[ x~]\] `T-\d+`.*$/gm) ?? [];
      expect(tasks.length, f).toBeGreaterThan(0);
      expect(
        tasks.filter((t) => !/Gate:/.test(t)),
        f,
      ).toEqual([]);
      const ids = tasks.map((t) => /`(T-\d+)`/.exec(t)![1]);
      expect(new Set(ids).size, f).toBe(ids.length);
    }
  });

  it("PM-PLAN-006: PLAN có mục Ngân sách (4 con số)", () => {
    for (const f of plans)
      expect(read(f), f).toMatch(/^## Ngân sách \(4 con số\)/m);
  });
});

describe("sổ rủi ro và bàn giao (PM-RISK, PM-HANDOVER)", () => {
  const rows = risks
    .split("\n")
    .filter((l) => /^\| RK-\d{3} \|/.test(l))
    .map((l) =>
      l
        .split("|")
        .map((c) => c.trim())
        .slice(1, -1),
    );

  it("PM-RISK-001: mỗi RK-NNN đủ 11 cột, điểm = khả năng × tác động, có ngày rà", () => {
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const r of rows) {
      expect(r, r[0]).toHaveLength(11);
      expect(Number(r[5]), r[0]).toBe(Number(r[3]) * Number(r[4]));
      expect(r[9], r[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(
        r.every((c) => c !== ""),
        r[0],
      ).toBe(true);
    }
    expect(new Set(rows.map((r) => r[0])).size).toBe(rows.length);
  });

  it("PM-RISK-006: mỗi phụ thuộc lõi trong package.json có dòng thẩm định kèm giấy phép", () => {
    const section = risks.split("## Phụ thuộc bên thứ ba quan trọng")[1] ?? "";
    for (const name of [
      "Next.js",
      "React",
      "Better Auth",
      "pg-boss",
      "Drizzle ORM",
      "Zod",
      "SocialAPI",
    ]) {
      const line = section.split("\n").find((l) => l.startsWith(`| ${name}`));
      expect(line, name).toBeDefined();
      expect(line, name).toMatch(/MIT|Apache-2\.0|chưa xác minh/);
    }
    const pkg = JSON.parse(read("package.json")) as {
      dependencies: Record<string, string>;
    };
    for (const dep of ["next", "react", "better-auth", "pg-boss", "zod"]) {
      expect(pkg.dependencies[dep], dep).toBeDefined();
    }
  });

  it("PM-HANDOVER-002: gói bàn giao có README, RUNBOOK, ADR, PROGRESS, sổ rủi ro, danh sách tài khoản (không bí mật)", () => {
    for (const f of [
      "README.md",
      "docs/RUNBOOK.md",
      "docs/adr",
      "PROGRESS.md",
      "docs/RISKS.md",
      "docs/handover/accounts.md",
    ])
      expect(existsSync(f), f).toBe(true);
    expect(read("docs/handover/accounts.md")).not.toMatch(
      /sk-[A-Za-z0-9]{10,}|password\s*[:=]\s*\S+|BEGIN [A-Z ]*PRIVATE KEY/i,
    );
  });
});

describe("quy trình làm việc (WF-TEAM, WF-REVIEW)", () => {
  it("WF-TEAM-003: mẫu issue tính năng có checklist Definition of Ready", () => {
    expect(read(".github/ISSUE_TEMPLATE/feature.yml")).toMatch(
      /Definition of Ready[\s\S]*Tiêu chí chấp nhận đo được/,
    );
  });

  it("WF-TEAM-004: mẫu PR có DoD với chỗ ghi bằng chứng cho từng mục", () => {
    expect(pr).toMatch(/^## Bằng chứng/m);
    expect(pr).toMatch(/tick không kèm bằng chứng là chưa xong/);
    for (const m of pr
      .split("## Bằng chứng")[1]!
      .split("##")[0]!
      .match(/^- \[ \] .*$/gm) ?? [])
      expect(m).toMatch(/:\s*$|—\s*\S*:?\s*$|link run:|tên test:|ID:/);
  });

  it("WF-TEAM-005: PROGRESS.md có Đang làm / Tiếp theo / Bàn giao và nêu việc chưa xác minh", () => {
    const p = read("PROGRESS.md");
    for (const h of ["## Đang làm", "## Tiếp theo", "## Bàn giao phiên"])
      expect(p).toContain(h);
    expect(p).toMatch(/[Cc]hưa xác minh/);
    expect(p).toMatch(/Lệnh kiểm/);
  });

  it("WF-REVIEW-001: `quality` là required check và mẫu PR có mục CI xanh", () => {
    expect(read(".github/rulesets/main.json")).toMatch(/"context": "quality"/);
    expect(pr).toMatch(/CI .*xanh/);
  });

  it("WF-REVIEW-002: mẫu PR có đủ Mục tiêu/Bằng chứng/Rủi ro và workflow pr-policy kiểm thân PR", () => {
    for (const h of ["## Mục tiêu", "## Bằng chứng", "## Rủi ro và đường lùi"])
      expect(pr).toContain(h);
    const wf = read(".github/workflows/pr-policy.yml");
    for (const h of ["## Mục tiêu", "## Bằng chứng", "## Rủi ro"])
      expect(wf).toContain(h);
  });

  it("WF-REVIEW-005: merge_review optional ⇒ ruleset để required_review_thread_resolution=false (nhất quán)", () => {
    const xt = read("xt.yaml");
    const optional = /^merge_review:\s*optional/m.test(xt);
    const rs = read(".github/rulesets/main.json");
    const resolution = /"required_review_thread_resolution":\s*true/.test(rs);
    expect(optional ? !resolution : resolution).toBe(true);
  });
});

describe("sức khoẻ cộng đồng (XC-OSS-001)", () => {
  it("có LICENSE, README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, SUPPORT, mẫu issue và mẫu PR", () => {
    for (const f of [
      "LICENSE",
      "README.md",
      "CONTRIBUTING.md",
      "CODE_OF_CONDUCT.md",
      "SECURITY.md",
      "SUPPORT.md",
      ".github/pull_request_template.md",
      ".github/ISSUE_TEMPLATE/bug.yml",
      ".github/ISSUE_TEMPLATE/feature.yml",
    ])
      expect(existsSync(f), f).toBe(true);
  });
});
