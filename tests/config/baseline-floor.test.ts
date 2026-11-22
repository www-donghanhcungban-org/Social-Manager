import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Hàng rào máy cho các mục sàn của blueprint (BASE-*) mà không có test hành vi riêng: quét mã đã commit.
 * Mỗi `it` ghi ID mục nó kiểm; blueprint tick kèm `— Kiểm: npx vitest run tests/config/baseline-floor.test.ts`.
 */
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf-8" })
  .split("\0")
  .filter(Boolean);
const code = tracked.filter(
  (f) =>
    /^(src|app|scripts)\/.*\.(ts|tsx|mjs|js)$/.test(f) ||
    f === "proxy.ts" ||
    f === "instrumentation.ts",
);
const read = (f: string) => readFileSync(f, "utf-8");
const hits = (files: string[], re: RegExp) =>
  files.flatMap((f) =>
    read(f)
      .split("\n")
      .flatMap((line, i) =>
        re.test(line) ? [`${f}:${i + 1}: ${line.trim()}`] : [],
      ),
  );

describe("sàn blueprint quét trên mã đã commit", () => {
  it("BASE-ERR-001: không có lỗi bị nuốt (catch rỗng, .catch(() => {}))", () => {
    expect(
      hits(
        code,
        /catch\s*(\([^)]*\))?\s*\{\s*\}|\.catch\(\s*\(\)\s*=>\s*(\{\s*\}|undefined|null)\s*\)/,
      ),
    ).toEqual([]);
  });

  it("BASE-CFG-006: không script/CLI nào nhận bí mật qua cờ dòng lệnh", () => {
    const pkg = read("package.json");
    const re = /--(password|passwd|token|secret|api-?key)\b/i;
    expect(re.test(pkg)).toBe(false);
    expect(
      hits(
        code.filter((f) => f.startsWith("scripts/")),
        re,
      ),
    ).toEqual([]);
  });

  it("BASE-CFG-007: không tắt kiểm TLS, không mở CORS, không bind/khoá mặc định không an toàn trong mã", () => {
    expect(
      hits(
        code,
        /NODE_TLS_REJECT_UNAUTHORIZED|rejectUnauthorized\s*:\s*false|Access-Control-Allow-Origin|DEBUG\s*=\s*true/,
      ),
    ).toEqual([]);
  });

  it("BASE-SEC-007: không nối chuỗi vào SQL/lệnh hệ thống (sql.raw chỉ với hằng của schema, không exec shell)", () => {
    const raw = hits(code, /sql\.raw\(/);
    expect(raw.every((h) => h.startsWith("src/db/schema.ts:"))).toBe(true);
    expect(
      hits(code, /child_process|\bexecSync\(|(^|[^.\w])exec\(|shell:\s*true/),
    ).toEqual([]);
  });

  it("BASE-DATA-005 (điều kiện Không áp dụng): schema không có cột tiền hay kiểu số thực", () => {
    const sql = tracked
      .filter(
        (f) => /^drizzle\/\d+_.*\.sql$/.test(f) && !f.endsWith(".down.sql"),
      )
      .map(read)
      .join("\n");
    expect(
      /"(price|amount|cost|money|balance|total|currency)[a-z_]*"|\b(real|double precision|numeric|money|float)\b/i.test(
        sql,
      ),
    ).toBe(false);
  });

  it("BASE-DOC-003: có ADR chọn stack; mỗi ADR đủ bối cảnh, phương án, quyết định, hệ quả", () => {
    const adrs = tracked.filter(
      (f) => /^docs\/adr\/\d{4}-.*\.md$/.test(f) && !f.includes("template"),
    );
    expect(adrs.some((f) => f.includes("stack"))).toBe(true);
    for (const f of adrs) {
      const md = read(f);
      for (const h of [/Bối cảnh/, /phương án/i, /Quyết định/, /Hệ quả/])
        expect(md, `${f} thiếu ${h}`).toMatch(
          new RegExp(`^#{2,3} .*${h.source}`, `m${h.flags}`),
        );
    }
  });

  it("BASE-GATE-005: CI không cho bước nào đỏ mà vẫn xanh (continue-on-error)", () => {
    const wf = tracked.filter((f) => f.startsWith(".github/workflows/"));
    expect(hits(wf, /continue-on-error:\s*true/)).toEqual([]);
  });
});
