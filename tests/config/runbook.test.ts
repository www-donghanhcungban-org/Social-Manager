import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const runbook = readFileSync("docs/RUNBOOK.md", "utf-8");
const compose = readFileSync("docker-compose.yml", "utf-8");

describe("RUNBOOK.md (BASE-DOC-004)", () => {
  it("có đủ các mục của mẫu", () => {
    for (const h of [
      "## 0. Thông tin nhanh",
      "## 1. Lệnh vận hành (chép-chạy)",
      "### Kiểm tra sức khoẻ",
      "### Deploy",
      "### Rollback",
      "### Migration CSDL",
      "### Backup và khôi phục",
      "### Xoay bí mật",
      "## 2. Cảnh báo → playbook",
      "## 4. Leo thang",
    ])
      expect(runbook, h).toContain(h);
  });

  it("mọi tệp/script được nhắc tới đều có thật", () => {
    const paths = [
      ...runbook.matchAll(
        /(?:scripts|drizzle|docs)\/[A-Za-z0-9_./-]+\.(?:mjs|sql|md)/g,
      ),
    ].map((m) => m[0]);
    expect(paths.length).toBeGreaterThan(2);
    for (const p of new Set(paths)) expect(existsSync(p), p).toBe(true);
    expect(existsSync("app/api/health/route.ts")).toBe(true);
    expect(runbook).toContain("/api/health");
  });

  it("nêu đủ bốn biến bí mật bắt buộc của compose và không ghi giá trị", () => {
    const required = [...compose.matchAll(/\$\{(\w+):\?/g)].map((m) => m[1]!);
    expect(required.length).toBeGreaterThanOrEqual(4);
    for (const v of required) expect(runbook, v).toContain(v);
    expect(runbook).not.toMatch(
      /(SECRET|PASSWORD|KEY)\s*=\s*[A-Za-z0-9+/]{16,}/,
    );
  });

  it("thông điệp log được dẫn trong playbook có trong mã", () => {
    const logs = [...runbook.matchAll(/log `([^`]+)`/g)].map((m) => m[1]!);
    expect(logs.length).toBeGreaterThan(0);
    const src = ["src/jobs/start.ts", "instrumentation.ts"]
      .map((f) => readFileSync(f, "utf-8"))
      .join("\n");
    for (const l of logs) expect(src, l).toContain(l);
  });

  it("nói thật phần chưa có: cảnh báo tự động và diễn tập", () => {
    expect(runbook).toMatch(/chưa có hệ thống cảnh báo/i);
    expect(runbook).toMatch(/chưa diễn tập/i);
  });
});

const read = (f: string) => readFileSync(f, "utf-8");
const TODAY = new Date("2026-11-24T00:00:00Z");
const ageDays = (ymd: string) =>
  (TODAY.getTime() - new Date(`${ymd}T00:00:00Z`).getTime()) / 86_400_000;

describe("diễn tập và hạn (WF-DOC-008, WF-REL-004)", () => {
  // Bảng "Diễn tập và hạn": cột 3 là last_drilled, ngày YYYY-MM-DD hoặc "chưa".
  const rows = runbook
    .split("### Diễn tập và hạn")[1]!
    .split(/\n#{2,3} /)[0]!
    .split("\n")
    .filter((l) => l.startsWith("|") && !/^\|\s*(Mục|-)/.test(l))
    .map((l) => l.split("|").map((c) => c.trim()));

  it("mỗi mục vận hành có trường last_drilled hợp lệ", () => {
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (const r of rows)
      expect(r[3], r[1]).toMatch(/^(\d{4}-\d{2}-\d{2}|chưa)$/);
  });

  it("ngày diễn tập không quá 6 tháng (183 ngày) và không ở tương lai", () => {
    for (const r of rows.filter((x) => x[3] !== "chưa")) {
      expect(ageDays(r[3]!), r[1]).toBeGreaterThanOrEqual(0);
      expect(ageDays(r[3]!), `${r[1]} quá hạn diễn tập`).toBeLessThanOrEqual(
        183,
      );
    }
  });

  it("mục chưa diễn tập nêu thật: rollback chưa diễn tập", () => {
    const rollback = rows.find((r) => /Rollback/.test(r[1]!))!;
    expect(rollback[3]).toBe("chưa");
  });
});

describe("rollback, smoke, migration trong runbook (WF-REL-004/007, DB-MIG-011)", () => {
  it("rollback nêu bản trước, lệnh lùi, tương thích ngược và smoke sau khi lùi", () => {
    const section = runbook
      .split("### Rollback ứng dụng")[1]!
      .split("### ")[0]!;
    expect(section).toMatch(/tag phát hành gần nhất/);
    expect(section).toMatch(/git checkout v/);
    expect(section).toMatch(/docker compose up -d --build/);
    expect(section).toMatch(/smoke/i);
    expect(section).toMatch(/\.down\.sql/);
  });

  it("smoke có ngưỡng lùi và cửa sổ theo dõi", () => {
    const section = runbook
      .split("### Smoke test sau deploy")[1]!
      .split("### ")[0]!;
    expect(section).toMatch(/15 phút/);
    expect(section).toMatch(/5xx/);
    expect(section).toMatch(/node scripts\/smoke\.mjs/);
  });

  it("PR template có mục Backup trước migrate và kế hoạch lùi", () => {
    const t = read(".github/pull_request_template.md");
    expect(t).toMatch(/Backup trước migrate:/);
    expect(t).toMatch(/Kế hoạch lùi:/);
    expect(t).toMatch(/contract/);
  });
});

describe("sao lưu và khôi phục (DB-BACKUP-002/003, OPS-DR-008) [F-005/AC-08]", () => {
  const backup = read("scripts/backup.sh");

  it("sao lưu chạy theo lịch (cron mẫu trong runbook) và có xoay vòng", () => {
    expect(runbook).toMatch(/\* \* \* cd .*scripts\/backup\.sh/);
    expect(backup).toMatch(/BACKUP_KEEP/);
  });

  it("thất bại để lại dấu vết: trap ERR, FAILED, thoát khác 0, webhook chỉ https", () => {
    expect(backup).toMatch(/set -euo pipefail/);
    expect(backup).toMatch(/trap .*ERR/);
    expect(backup).toMatch(/FAILED/);
    expect(backup).toMatch(/https:\/\/\*\)/);
  });

  it("dump được kiểm đọc lại và có băm", () => {
    expect(backup).toMatch(/pg_restore --list/);
    expect(backup).toMatch(/sha256sum/);
  });

  it("có bản ghi diễn tập khôi phục: ngày, bản dùng, RTO đo, kiểm tra, người", () => {
    const drills = read("docs/ops/restore-drills.md");
    const rows = drills
      .split("\n")
      .filter((l) => /^\| \d{4}-\d{2}-\d{2} \|/.test(l));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const c = r.split("|").map((x) => x.trim());
      expect(c[2], "bản sao lưu").toMatch(/\.dump/);
      expect(c[3], "RTO đo").toMatch(/^\d+s$/);
      expect(c[4], "kiểm tra").toMatch(/migration=\d+/);
      expect(c[5], "người làm").not.toBe("");
    }
  });

  it("runbook khôi phục từng kho có lệnh, thứ tự và cách kiểm", () => {
    const db = read("docs/ops/runbooks/restore-database.md");
    const blobs = read("docs/ops/runbooks/restore-blobs.md");
    expect(db).toMatch(/pg_restore/);
    expect(db).toMatch(/Thứ tự phụ thuộc/);
    expect(db).toMatch(/smoke/);
    expect(blobs).toMatch(/sha256sum -c/);
    expect(blobs).toMatch(/khôi phục CSDL và blob cùng một mốc/);
    expect(runbook).toContain("ops/runbooks/restore-database.md");
    expect(runbook).toContain("ops/runbooks/restore-blobs.md");
  });
});

describe("SLO và sự cố (OPS-SLO-001, OPS-IR-001/004/010)", () => {
  const slo = read("docs/ops/SLO.md");

  it("SLI availability và latency dạng tỉ lệ tốt/tổng, dùng metric và cận có thật", () => {
    const queries = [...slo.matchAll(/```promql\n([\s\S]*?)```/g)].map(
      (m) => m[1]!,
    );
    expect(queries).toHaveLength(2);
    const metrics = read("src/observability/metrics.ts");
    for (const q of queries) {
      expect(q).toMatch(/\)\s*\/\s*sum\(/);
      for (const name of q.matchAll(
        /(http_server_request_duration_seconds\w*)/g,
      ))
        expect(metrics, name[1]).toContain(name[1]!);
      // dấu ngoặc cân bằng: lỗi cú pháp rõ nhất khi viết tay
      expect([...q].filter((c) => c === "(").length).toBe(
        [...q].filter((c) => c === ")").length,
      );
    }
    expect(queries[1]).toMatch(/le="0\.8"/);
    expect(metrics).toMatch(/BUCKETS = \[[^\]]*\b0\.8\b/);
    expect(slo).toMatch(/SLI availability/);
    expect(slo).toMatch(/SLI latency/);
  });

  const ir = read("docs/ops/incident-response.md");
  const section = ir
    .split("## X-Workspace: SEV1–SEV4")[1]!
    .split("## Phân mức nghiêm trọng")[0]!;

  it("SEV1–SEV4 mỗi mức ≥ 2 ví dụ, có thời gian phản ứng và người tuyên bố", () => {
    expect(section).toMatch(/Người được tuyên bố sự cố/);
    for (const sev of ["SEV1", "SEV2", "SEV3", "SEV4"]) {
      const row = section.split("\n").find((l) => l.startsWith(`| **${sev}**`));
      expect(row, sev).toBeTruthy();
      const cells = row!.split("|").map((c) => c.trim());
      expect(
        cells[3]!.split(";").length,
        `${sev} ví dụ`,
      ).toBeGreaterThanOrEqual(2);
      expect(cells[4], `${sev} phản hồi`).not.toBe("");
    }
  });

  it("thứ tự xử lý cố định: giảm thiệt hại trước nguyên nhân gốc", () => {
    expect(section).toMatch(
      /phát hiện → phân mức → \*\*giảm thiệt hại\*\*.*→ liên lạc → khắc phục.*→ đóng → post-mortem/,
    );
  });

  it("nhánh sự cố bảo mật: SEV1, bảo toàn chứng cứ, xoay bí mật, nghĩa vụ thông báo", () => {
    expect(section).toMatch(/luôn là SEV1/);
    expect(section).toMatch(/Bảo toàn chứng cứ/);
    expect(section).toMatch(/Thu hồi, xoay bí mật/);
    expect(section).toMatch(/runbooks\/data-breach\.md/);
  });
});
