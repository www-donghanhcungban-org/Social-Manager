import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * MUST nhóm chiến lược test (T-517): mỗi `it` nêu ID nó giữ. Blueprint tick kèm
 * `— Kiểm: npx vitest run tests/config/test-strategy.test.ts`.
 */
const read = (f: string) => readFileSync(f, "utf-8");
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/**
 * Ngưỡng đã đạt (ratchet, QA-COV-002): chỉ được TĂNG. Hạ số ở đây hay ở `vitest.config.mts` đều là diff
 * cấu hình cổng, cần lý do trong commit/PR (LOOP-CI-001, QA-COV-008).
 */
const BASELINE = { lines: 90, functions: 85, statements: 90, branches: 85 };

describe("coverage nhánh + ratchet (QA-COV-001, QA-COV-002, QA-COV-008)", () => {
  const cfg = read("vitest.config.mts");

  it("QA-COV-001: đo nhánh, báo cáo có json-summary/lcov và CI lưu artifact coverage", () => {
    expect(cfg).toMatch(/provider:\s*"v8"/);
    expect(cfg).toMatch(/reporter:\s*\[[^\]]*"json-summary"[^\]]*\]/);
    expect(cfg).toMatch(/reporter:\s*\[[^\]]*"lcov"[^\]]*\]/);
    expect(cfg).toMatch(/branches:\s*\d+/);
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toMatch(/name:\s*coverage\b[\s\S]{0,200}path:\s*coverage\//);
  });

  it("QA-COV-002: ngưỡng lines và branches là số, không thấp hơn baseline đã đạt", () => {
    for (const [k, min] of Object.entries(BASELINE)) {
      const m = new RegExp(`${k}:\\s*(\\d+)`).exec(cfg);
      expect(m, k).not.toBeNull();
      expect(Number(m?.[1]), k).toBeGreaterThanOrEqual(min);
    }
  });

  it("QA-COV-008: không thêm exclude vào coverage; guard hỏi khi sửa vitest.config", () => {
    expect(cfg).not.toMatch(/exclude:/);
    expect(cfg).toMatch(/include:\s*\["src\/\*\*\/\*\.ts"\]/);
    const out = execFileSync("bash", [".claude/hooks/pre-edit-guard.sh"], {
      encoding: "utf-8",
      input: JSON.stringify({
        tool_name: "Edit",
        tool_input: {
          file_path: join(process.cwd(), "vitest.config.mts"),
          old_string: "branches: 80",
          new_string: "branches: 10",
        },
      }),
      // Mặc định guard cho chạy kèm lý do (ADR-0018); lớp hỏi bật bằng chính sách strict (CLAUDE.md).
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: process.cwd(),
        XT_GUARD_POLICY: "strict",
      },
    });
    expect(out).toMatch(/"permissionDecision":\s*"(ask|deny)"/);
  });
});

describe("mọi test có assertion (QA-COV-004)", () => {
  /** Đếm `it`/`test` có thân gọi `expect*`/`assert*` (kể cả qua `.rejects`, helper `expect…`). */
  function testsWithoutAssertion(file: string): string[] {
    const sf = ts.createSourceFile(
      file,
      read(file),
      ts.ScriptTarget.Latest,
      true,
    );
    const bad: string[] = [];
    const calls = (n: ts.Node): boolean => {
      let found = false;
      const visit = (x: ts.Node) => {
        if (found) return;
        if (ts.isCallExpression(x)) {
          const t = x.expression.getText(sf);
          if (
            /^(expect|assert|await expect)/.test(t) ||
            /(^|\.)expect[A-Z\w]*$/.test(t)
          )
            found = true;
          if (/^(await )?(assert|fail)\b/.test(t)) found = true;
        }
        ts.forEachChild(x, visit);
      };
      visit(n);
      return found;
    };
    const walkNode = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const callee = n.expression.getText(sf);
        if (
          /^(it|test)(\.(each|skip|only|fails|concurrent))?$/.test(
            callee.replace(/\(.*$/, ""),
          )
        ) {
          const fn = n.arguments.find(
            (a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a),
          );
          if (fn && !calls(fn))
            bad.push(`${file}: ${n.arguments[0]?.getText(sf).slice(0, 80)}`);
        }
      }
      ts.forEachChild(n, walkNode);
    };
    walkNode(sf);
    return bad;
  }

  it("không có test (it/test) nào thiếu assertion trong tests/ và e2e/", () => {
    const files = [...walk("tests"), ...walk("e2e")].filter((f) =>
      /\.(test|spec)\.ts$/.test(f),
    );
    expect(files.length).toBeGreaterThan(50);
    expect(files.flatMap(testsWithoutAssertion)).toEqual([]);
  });
});

describe("E2E (QA-E2E-001/005/006, FE-TEST-002, PRF-WEB-006)", () => {
  const pw = read("playwright.config.ts");
  const specs = walk("e2e").filter((f) => f.endsWith(".spec.ts"));

  it("QA-E2E-001: ít nhất 3 test gắn @smoke; job e2e có trong tổng hợp quality", () => {
    const n = specs.reduce(
      (a, f) => a + (read(f).match(/^test\(.*@smoke/gm)?.length ?? 0),
      0,
    );
    expect(n).toBeGreaterThanOrEqual(3);
    expect(read(".github/workflows/ci.yml")).toMatch(/needs: \[gate, e2e\]/);
  });

  it("QA-E2E-005: forbidOnly, retries ≤ 2, trace on-first-retry, workers cố định ở CI", () => {
    expect(pw).toMatch(/forbidOnly:\s*!!process\.env\.CI/);
    expect(pw).toMatch(/retries:\s*process\.env\.CI \? 2 : 0/);
    expect(pw).toMatch(/trace:\s*"on-first-retry"/);
    expect(pw).toMatch(/workers:\s*process\.env\.CI \? \d+/);
  });

  it("QA-E2E-006: baseURL cục bộ; test tự tạo người dùng email example.com duy nhất, không tài khoản thật", () => {
    expect(pw).toMatch(/baseURL:\s*"http:\/\/localhost:\d+"/);
    expect(pw).not.toMatch(/baseURL:[^\n]*(https?:\/\/(?!localhost))/);
    const creating = specs.filter((f) => /randomUUID\(\)/.test(read(f)));
    expect(creating.length).toBeGreaterThanOrEqual(6);
    for (const f of specs) {
      const emails = read(f).match(/[\w.+-]+@[\w.-]+\.\w+/g) ?? [];
      for (const e of emails)
        expect(e, `${f}: ${e}`).toMatch(/@example\.(com|test|org)$/);
    }
    expect(read("docs/compliance/test-data-policy.md")).toMatch(/CSDL tạm/);
  });

  it("FE-TEST-002, PRF-WEB-006: hai project desktop và mobile; axe quét trên cả hai khung hình, không vi phạm", () => {
    expect(pw).toMatch(/name:\s*"desktop"/);
    expect(pw).toMatch(/name:\s*"mobile"/);
    const a11y = read("e2e/a11y-responsive.spec.ts");
    expect(a11y).toMatch(/AxeBuilder/);
    expect(a11y).toMatch(/violations[\s\S]{0,120}toEqual\(\[\]\)/);
    expect(a11y).toMatch(/mobile-320/);
    expect(a11y).toMatch(/desktop-1280/);
  });
});

describe("CSDL test (QA-INT-001, QA-INT-002)", () => {
  it("QA-INT-001: CI chạy Postgres 16 thật, trùng major với compose/PROJECT.md; PGlite ghi rõ vai trò", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toMatch(/image:\s*postgres:16/);
    expect(read("docker-compose.yml")).toMatch(/image:\s*postgres:16@/);
    const p = read("PROJECT.md");
    expect(p).toMatch(/PostgreSQL 16/);
    expect(p).toMatch(/PGlite/);
    expect(p).toMatch(/Postgres 16 thật/);
    expect(existsSync("tests/auth/members.pg.test.ts")).toBe(true);
  });

  it("QA-INT-002: DB test dựng bằng chuỗi migration từ rỗng; không schema.sql dựng tay", () => {
    expect(read("tests/db/helpers.ts")).toMatch(/migrate\(db/);
    const all = walk(".").filter(
      (f) => !f.includes("node_modules") && !f.includes(".git/"),
    );
    expect(all.filter((f) => /(^|\/)schema\.sql$/.test(f))).toEqual([]);
  });
});

describe("test tất định (FE-TEST-003)", () => {
  it("TZ cố định UTC cho vitest và Playwright; ngẫu nhiên có chủ đích dùng randomUUID/seed, không Math.random trong test", () => {
    expect(read("vitest.config.mts")).toMatch(/process\.env\.TZ\s*=\s*"UTC"/);
    const pw = read("playwright.config.ts");
    expect(pw).toMatch(/timezoneId:\s*"UTC"/);
    expect(pw).toMatch(/locale:\s*"vi-VN"/);
    const offenders = [...walk("tests"), ...walk("e2e")]
      .filter(
        (f) => f.endsWith(".ts") && f !== "tests/config/test-strategy.test.ts",
      )
      .filter((f) => /Math\.random\(/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe("tính đúng khi ghi (QA-UNIT-007, QA-UNIT-008, QA-UNIT-010)", () => {
  it("QA-UNIT-007: có test gửi lại cùng khoá idempotency cho bài, hành động gửi tin và webhook", () => {
    expect(read("tests/posts/service.test.ts")).toMatch(
      /gửi lại cùng khoá idempotency trả đúng bài cũ/,
    );
    expect(read("tests/actions/ledger.test.ts")).toMatch(
      /hai yêu cầu song song cùng khoá chỉ tạo một dòng/,
    );
  });

  it("QA-UNIT-008: có test song song giữ bất biến (một owner, một dispatch, không đăng trùng)", () => {
    expect(read("tests/auth/members.pg.test.ts")).toMatch(/Promise\.all/);
    expect(read("tests/actions/ledger.test.ts")).toMatch(
      /hai dispatch song song: chỉ một thắng/,
    );
    expect(read("tests/posts/service.test.ts")).toMatch(
      /hai worker chạy song song không đăng trùng/,
    );
  });

  it("QA-UNIT-010: lỗi giữa giao dịch hoàn tác bước trước (tests/workspaces/atomicity.test.ts)", () => {
    const t = read("tests/workspaces/atomicity.test.ts");
    expect(t).toMatch(/all-or-nothing/);
    expect(t).toMatch(/không còn workspace mồ côi/);
  });
});

describe("dữ liệu test không PII thật (QA-DATA-001/002/007, FE-TEST-006)", () => {
  const files = [...walk("tests"), ...walk("e2e")].filter((f) =>
    /\.(ts|tsx|json|csv|sql)$/.test(f),
  );

  it("QA-DATA-001: PROJECT.md có mục Dữ liệu test cấm dump production; không file dữ liệu > 1 MB", () => {
    expect(read("PROJECT.md")).toMatch(
      /### Dữ liệu test[\s\S]*\*\*Cấm\*\* đưa dump/,
    );
    const data = walk(".").filter(
      (f) =>
        /\.(sql|csv|dump|json)$/.test(f) &&
        !/node_modules|\.next|\.git\/|package-lock|coverage|\.autopilot/.test(
          f,
        ),
    );
    for (const f of data) expect(statSync(f).size, f).toBeLessThan(1_000_000);
  });

  it("QA-DATA-002: mọi email trong fixture/test thuộc tên miền dành riêng; không SĐT VN dạng thật", () => {
    // Email: chỉ tên miền dành riêng, cục bộ (`localhost`) hoặc suffix tên miền giả trong test.
    const allowed =
      /@(example\.(com|test|org|net)|localhost|[\w-]+\.(test|invalid|example))$/i;
    const emails = files.flatMap((f) =>
      // Bỏ phần mật khẩu trong URL kết nối (`user:pass@host`) và chính file này.
      (f === "tests/config/test-strategy.test.ts"
        ? []
        : (read(f).match(/(?<![:\w.+-])[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [])
      )
        .filter((e) => !/\.(tsx?|js|json|md)$/.test(e)) // chuỗi kiểu `a@1.2.3`/tên gói
        .filter((e) => !/@\d+\.\d+\.\d+\.\d+$/.test(e)) // `user@10.0.0.5` trong URL kết nối, không phải email
        .filter((e) => !/^@/.test(e) && !allowed.test(e))
        .map((e) => `${f}: ${e}`),
    );
    expect(emails).toEqual([]);
    const phones = files.flatMap((f) =>
      (
        read(f).match(/(?<![\w.])(?:\+84|0)(?:3|5|7|8|9)\d{8}(?!\d)/g) ?? []
      ).map((p) => `${f}: ${p}`),
    );
    expect(phones).toEqual([]);
    expect(read("docs/compliance/test-data-policy.md")).toMatch(/example\.com/);
  });

  it("QA-DATA-007: không dùng bản sao ẩn danh hoá — không có scripts/anonymize, chính sách nói rõ", () => {
    expect(existsSync("scripts/anonymize")).toBe(false);
    expect(read("docs/compliance/test-data-policy.md")).toMatch(
      /Không dùng bản sao ẩn danh hoá/,
    );
  });

  it("FE-TEST-006: PR `fix` thiếu test bị pr-policy cảnh báo (QA-STRAT-005)", () => {
    expect(read(".github/workflows/pr-policy.yml")).toMatch(/QA-STRAT-005/);
  });
});
