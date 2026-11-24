import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * MUST nhóm kiến trúc (T-518): thay dependency-cruiser/import-linter bằng test tự viết (ADR-0007).
 * Blueprint tick kèm `— Kiểm: npx vitest run tests/config/architecture.test.ts`.
 * Chỉ nhận import tĩnh dạng `from "…"` / `import "…"` (đủ cho mã của dự án).
 */
const read = (f: string) => readFileSync(f, "utf-8");
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const isCode = (f: string) => /\.(ts|tsx)$/.test(f);
const srcFiles = walk("src").filter(isCode);
const appFiles = walk("app").filter(isCode);

function specifiers(file: string): string[] {
  const t = read(file);
  const out: string[] = [];
  for (const m of t.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g))
    out.push(m[1]!);
  return out;
}

/** Đường dẫn dự án của một import nội bộ (`@/…` hoặc tương đối), không đuôi; null nếu là gói ngoài. */
function resolveLocal(from: string, spec: string): string | null {
  let p: string;
  if (spec.startsWith("@/")) p = spec.slice(2);
  else if (spec.startsWith(".")) p = normalize(join(dirname(from), spec));
  else return null;
  for (const c of [p, `${p}.ts`, `${p}.tsx`, `${p}/index.ts`, `${p}/index.tsx`])
    if (existsSync(c) && statSync(c).isFile()) return c;
  return p;
}
const moduleOf = (f: string) => f.split("/")[1] ?? "";

describe("kiểu kiến trúc và ADR (ARC-STYLE-001/002/003, ARC-ADR-001..004)", () => {
  const adrDir = "docs/adr";
  const adrs = readdirSync(adrDir).filter((f) => f.endsWith(".md"));
  const real = adrs.filter((f) => !f.startsWith("0000-"));

  it("ARC-ADR-001/002: có mẫu và ADR stack; tên NNNN-slug-kebab.md, số tăng dần không trùng không hụt", () => {
    expect(existsSync(`${adrDir}/0000-template.md`)).toBe(true);
    expect(adrs.some((f) => f.startsWith("0001-"))).toBe(true);
    const nums = adrs.map((f) => {
      const m = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.exec(f);
      expect(m, f).not.toBeNull();
      return Number(m![1]);
    });
    expect(new Set(nums).size).toBe(nums.length);
    const sorted = [...nums].sort((a, b) => a - b);
    sorted.forEach((n, i) => expect(n, "số ADR liên tục từ 0000").toBe(i));
  });

  it("ARC-ADR-003: mỗi ADR có trạng thái, ngày, bối cảnh, ≥ 2 phương án, quyết định, hệ quả", () => {
    for (const f of real) {
      const t = read(`${adrDir}/${f}`);
      expect(t, `${f} status`).toMatch(
        /^status:\s*\S+|^\- \*\*Trạng thái:\*\*/m,
      );
      expect(t, `${f} date`).toMatch(
        /^date:\s*\d{4}-\d{2}-\d{2}|^\- \*\*Ngày:\*\*/m,
      );
      expect(t, `${f} context`).toMatch(/^## Bối cảnh/m);
      expect(t, `${f} quyết định`).toMatch(/^## Quyết định/m);
      // ADR-0001 đã `accepted` từ trước khi có mục này: pr-policy cấm sửa nội dung ADR đã chấp nhận (chỉ viết ADR mới
      // thay thế), nên miễn đúng tệp đó; hệ quả của lựa chọn stack được ghi ở ADR-0007. ADR mới phải có mục này.
      if (f !== "0001-stack.md")
        expect(t, `${f} hệ quả`).toMatch(/^## Hệ quả/m);
      const opts = /^## Các phương án đã cân nhắc\n([\s\S]*?)(?=^## )/m.exec(t);
      expect(opts, `${f} phương án`).not.toBeNull();
      const items = (opts![1] ?? "").match(/^\s*(?:\d+\.|[-*])\s+\S/gm) ?? [];
      expect(items.length, `${f}: ≥ 2 phương án`).toBeGreaterThanOrEqual(2);
    }
  });

  it("ARC-STYLE-001/002: ADR-0007 chốt modular monolith với ≥ 2 phương án, điều kiện đọc lại và mục Bằng chứng tách", () => {
    const t = read(`${adrDir}/0007-modular-monolith.md`);
    expect(t).toMatch(/^status:\s*accepted/m);
    expect(t).toMatch(/^# ADR-0007: .*modular monolith/im);
    expect(t).toMatch(/^## Các phương án đã cân nhắc/m);
    expect(t).toMatch(/^## Điều kiện đọc lại/m);
    expect(t).toMatch(/^## Bằng chứng tách/m);
  });

  it("ARC-STYLE-002: đúng một deployable (một Dockerfile, một service build: trong compose) trừ khi ADR tách được trỏ tới", () => {
    const dockerfiles = walk(".")
      .filter((f) => !/node_modules|\.git\/|\.next/.test(f))
      .filter((f) => /(^|\/)Dockerfile(\.|$)/.test(f));
    expect(dockerfiles).toEqual(["Dockerfile"]);
    const builds = (read("docker-compose.yml").match(/^\s{4}build:/gm) ?? [])
      .length;
    expect(builds).toBe(1);
    expect(read("docs/ARCHITECTURE.md")).toMatch(/Một đơn vị triển khai/);
  });

  it("ARC-STYLE-003: cấu hình từ biến môi trường; không COPY .env vào image; không chuỗi kết nối/khoá trong mã nguồn", () => {
    expect(read("Dockerfile")).not.toMatch(/^\s*(COPY|ADD)\s+[^\n]*\.env/im);
    expect(read("src/config/env.ts")).toMatch(/process\.env|env\b/);
    for (const f of [...srcFiles, ...appFiles])
      expect(read(f), f).not.toMatch(
        /["'`](postgres(ql)?|mysql|mongodb|redis):\/\/[^"'`\s$]+:[^"'`\s$@]+@/,
      );
  });

  it("ARC-ADR-004: PR không sửa nội dung ADR đã chấp nhận — workflow pr-policy so diff, chỉ cho đổi dòng trạng thái/liên kết", () => {
    const w = read(".github/workflows/pr-policy.yml");
    expect(w).toMatch(/ARC-ADR-004/);
    expect(w).toMatch(/docs\/adr\//);
    expect(w).toMatch(/status: accepted/);
  });
});

describe("ranh giới module (ARC-MOD-003/004/005/008)", () => {
  /** Nơi được import khung web / hạ tầng. */
  const FRAMEWORK_OK = ["src/server/", "src/auth/client.ts"];
  const INFRA_OK = ["src/db/", "src/jobs/", "src/server/", "src/auth/"];
  /** Tệp "lõi thuần": quyết định bằng hàm, không I/O (ADR-0007). */
  const PURE = [
    "src/actions/policy.ts",
    "src/actions/text-hash.ts",
    "src/auth/permissions.ts",
    "src/auth/errors.ts",
    "src/http/errors.ts",
    "src/search/fold.ts",
    "src/ai/labels.ts",
    "src/ai/port.ts",
    "src/providers/types.ts",
    ...srcFiles.filter((f) => /^src\/(log|security)\//.test(f)),
  ];

  it("ARC-MOD-003: src/ không import next/react ngoài điểm nối khung; pg/pg-boss/better-auth chỉ ở thư mục hạ tầng; không import app/", () => {
    const bad: string[] = [];
    for (const f of srcFiles)
      for (const s of specifiers(f)) {
        if (
          /^(next|react|react-dom)(\/|$)/.test(s) &&
          !FRAMEWORK_OK.some((p) => f.startsWith(p))
        )
          bad.push(`${f} → ${s} (khung web)`);
        if (
          /^(pg|pg-boss|better-auth)(\/|$)|^drizzle-orm\/(node-postgres|pglite)/.test(
            s,
          ) &&
          !INFRA_OK.some((p) => f.startsWith(p))
        )
          bad.push(`${f} → ${s} (hạ tầng)`);
        if (s.startsWith("@/app/"))
          bad.push(`${f} → ${s} (src không phụ thuộc app)`);
      }
    expect(bad).toEqual([]);
  });

  it("ARC-MOD-003: tệp lõi thuần không import ORM, CSDL, khung, mạng hay module có I/O", () => {
    expect(PURE.length).toBeGreaterThan(10);
    const bad: string[] = [];
    for (const f of PURE) {
      expect(existsSync(f), f).toBe(true);
      // `import type` bị xoá khi biên dịch nên không tạo phụ thuộc lúc chạy.
      const runtime = read(f).replace(/import type[^;]*;/g, "");
      const specs = [
        ...runtime.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g),
      ].map((m) => m[1]!);
      for (const s of specs) {
        if (
          /^(drizzle-orm|pg|pg-boss|better-auth|next|react|node:(http|https|net|child_process))(\/|$)/.test(
            s,
          )
        )
          bad.push(`${f} → ${s}`);
        const local = resolveLocal(f, s);
        if (local && /^src\/(db|jobs|server)\//.test(local))
          bad.push(`${f} → ${s}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("ARC-MOD-004: không vòng import giữa các tệp src/", () => {
    const graph = new Map<string, string[]>();
    for (const f of srcFiles) {
      const deps = specifiers(f)
        .map((s) => resolveLocal(f, s))
        .filter(
          (p): p is string =>
            !!p && p.startsWith("src/") && srcFiles.includes(p),
        );
      graph.set(f, [...new Set(deps)]);
    }
    const state = new Map<string, 1 | 2>();
    const cycles: string[] = [];
    const stack: string[] = [];
    const dfs = (n: string) => {
      state.set(n, 1);
      stack.push(n);
      for (const d of graph.get(n) ?? []) {
        if (state.get(d) === 1)
          cycles.push([...stack.slice(stack.indexOf(d)), d].join(" → "));
        else if (!state.has(d)) dfs(d);
      }
      stack.pop();
      state.set(n, 2);
    };
    for (const n of graph.keys()) if (!state.has(n)) dfs(n);
    expect(cycles).toEqual([]);
  });

  it("ARC-MOD-005: ngoài module chỉ import tệp cấp một hoặc index.ts của module khác, không chui vào thư mục con nội bộ", () => {
    const bad: string[] = [];
    for (const f of [...srcFiles, ...appFiles])
      for (const s of specifiers(f)) {
        const local = resolveLocal(f, s);
        if (!local?.startsWith("src/")) continue;
        const parts = relative("src", local).split("/");
        const target = parts[0]!;
        const sameModule = f.startsWith(`src/${target}/`);
        const internal =
          parts.length > 2 && !/^index\.tsx?$/.test(parts[parts.length - 1]!);
        if (!sameModule && internal) bad.push(`${f} → ${s}`);
        if (/\/internal\//.test(s) && !sameModule) bad.push(`${f} → ${s}`);
      }
    expect(bad).toEqual([]);
  });

  it("ARC-MOD-008: thư mục cấp một của src/ khớp danh sách miền ở docs/architecture/domains.md", () => {
    const dirs = readdirSync("src")
      .filter((n) => statSync(join("src", n)).isDirectory())
      .sort();
    const listed = [
      ...read("docs/architecture/domains.md").matchAll(
        /^- `([a-z0-9-]+)` — /gm,
      ),
    ]
      .map((m) => m[1]!)
      .sort();
    expect(dirs).toEqual(listed);
    for (const d of dirs) expect(moduleOf(`src/${d}/x`)).toBe(d);
  });
});
