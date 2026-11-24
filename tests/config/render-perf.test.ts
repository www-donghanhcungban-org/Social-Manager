import { existsSync, readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { violations } from "../../scripts/check-bundle.mjs";

const read = (f: string) => readFileSync(f, "utf-8");
const walk = (d: string): string[] =>
  existsSync(d)
    ? readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`],
      )
    : [];
const code = [...walk("app"), ...walk("src")].filter((f) =>
  /\.(ts|tsx)$/.test(f),
);

/** `app/app/[workspaceId]/inbox/page.tsx` → `/app/[workspaceId]/inbox`; `app/page.tsx` → `/`. */
function routeOf(file: string): string {
  const dir = file
    .replace(/^app\//, "")
    .replace(/\/?(page\.tsx|route\.ts)$/, "");
  return `/${dir}`;
}

describe("chế độ render theo route (FE-RENDER-001, PRF-WEB-001)", () => {
  it("docs/ROUTES.md liệt kê đúng tập route thực của app/", () => {
    const real = walk("app")
      .filter((f) => /\/(page\.tsx|route\.ts)$/.test(f))
      .map(routeOf)
      .sort();
    const listed = [...read("docs/ROUTES.md").matchAll(/^\| `(\/[^`]*)` +\|/gm)]
      .map((m) => m[1]!)
      .sort();
    expect(real.length).toBeGreaterThan(10);
    expect(listed).toEqual(real);
  });

  it("mỗi dòng route có chế độ hợp lệ và lý do", () => {
    const rows = [
      ...read("docs/ROUTES.md").matchAll(
        /^\| `\/[^`]*` +\| *([^|]+?) *\| *([^|]+?) *\|$/gm,
      ),
    ];
    expect(rows.length).toBeGreaterThan(10);
    for (const [, mode, why] of rows) {
      expect(["động", "tĩnh", "API", "cache dùng chung", "CSR"]).toContain(
        mode,
      );
      expect(why!.length).toBeGreaterThan(5);
    }
  });

  it("ADR-0008 chốt render động, ghi phương án, và dữ liệu người dùng không vào cache dùng chung", () => {
    const t = read("docs/adr/0008-render-strategy.md");
    expect(t).toMatch(/^status:\s*accepted/m);
    expect(t).toMatch(/^## Các phương án đã cân nhắc/m);
    expect(t).toMatch(/private, no-store/);
  });

  it("proxy đặt Cache-Control private, no-store cho phản hồi động", () => {
    expect(read("proxy.ts")).toMatch(/private, no-store/);
  });

  it("e2e kiểm header cache và hai người dùng không thấy dữ liệu của nhau", () => {
    expect(read("e2e/security-headers.spec.ts")).toContain(
      '"private, no-store"',
    );
    expect(read("e2e/auth-flow.spec.ts")).toMatch(
      /người khác không mở được workspace của mình/,
    );
    expect(read("e2e/auth-flow.spec.ts")).toMatch(/private, no-store/);
  });
});

describe("không đọc dữ liệu theo request trong hàm cache (FE-RENDER-003)", () => {
  it("không có `use cache`, unstable_cache, cacheComponents, ISR cố định", () => {
    const bad = code.filter((f) =>
      /["']use cache|unstable_cache|export const revalidate|cacheLife\(/.test(
        read(f),
      ),
    );
    expect(bad).toEqual([]);
    expect(read("next.config.mjs")).not.toMatch(
      /cacheComponents:\s*true|ppr:\s*true/,
    );
  });

  it("tệp có `use cache` (nếu sau này có) không import cookies/headers", () => {
    const cached = code.filter((f) => /["']use cache/.test(read(f)));
    for (const f of cached)
      expect(read(f), f).not.toMatch(/\b(cookies|headers|draftMode)\b/);
  });
});

describe("một lớp lấy dữ liệu và làm mới sau mutation (FE-STATE-001, FE-STATE-003)", () => {
  it("không useEffect(() => fetch()) trong component", () => {
    const bad = code
      .filter((f) => f.endsWith(".tsx"))
      .filter((f) => /useEffect\([\s\S]{0,200}?\bfetch\(/.test(read(f)));
    expect(bad).toEqual([]);
  });

  it("dữ liệu đọc ở server component; client component không gọi fetch tới API nội bộ", () => {
    const clientFetch = walk("app")
      .filter((f) => f.endsWith(".tsx"))
      .filter((f) => /^\s*["']use client["']/m.test(read(f)))
      .filter((f) => /\bfetch\(/.test(read(f)));
    expect(clientFetch).toEqual([]);
  });

  it("mọi tệp actions.ts làm mới (revalidatePath) sau mutation thành công", () => {
    // Hỏi đáp chỉ đọc: kết quả trả qua state của form, không đổi dữ liệu hiển thị ở trang nào.
    const READ_ONLY = ["app/app/[workspaceId]/search/actions.ts"];
    const actions = walk("app")
      .filter((f) => f.endsWith("/actions.ts"))
      .filter((f) => !READ_ONLY.includes(f));
    expect(actions.length).toBeGreaterThan(5);
    for (const f of actions) {
      const t = read(f);
      // Làm mới đúng đường dẫn đã đổi, hoặc chuyển hướng sang trang kết quả (tạo workspace).
      expect(t, f).toMatch(/revalidatePath\(`?\/app\/|\bredirect\(/);
    }
  });
});

describe("ngân sách bundle ghi trong repo và chặn (FE-PERF-004, XC-PERF-003)", () => {
  const budget = JSON.parse(read("perf-budget.json")).budgets as {
    name: string;
    dir: string;
    exts: string[];
    gzip: boolean;
    mode: "total" | "each";
    limit_kb: number;
  }[];

  it("perf-budget.json có ngưỡng dương cho JS tổng, chunk lớn nhất và CSS", () => {
    expect(budget.map((b) => b.name)).toEqual([
      "js-total",
      "js-largest-chunk",
      "css-total",
    ]);
    for (const b of budget) {
      expect(b.limit_kb, b.name).toBeGreaterThan(0);
      expect(b.gzip).toBe(true);
    }
  });

  it("docs/PERF-BUDGET.md ghi lý do và đủ tên mục ngân sách", () => {
    const t = read("docs/PERF-BUDGET.md");
    for (const b of budget) expect(t, b.name).toContain(`\`${b.name}\``);
    expect(t).toMatch(/Lý do/);
  });

  it("CI chạy check-bundle sau gate-par", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toMatch(/node scripts\/check-bundle\.mjs/);
    expect(ci.indexOf("check-bundle")).toBeGreaterThan(ci.indexOf("gate-par"));
  });

  it("cổng thật sự chặn: thêm 200 kB vào bundle thì vi phạm; trong ngưỡng thì đạt", () => {
    const entry = (name: string) => budget.find((b) => b.name === name)!;
    const within = [
      {
        files: [{ path: "a.js", size_bytes: 1 }],
        total_bytes: (entry("js-total").limit_kb - 1) * 1000,
        max_bytes: (entry("js-largest-chunk").limit_kb - 1) * 1000,
      },
      {
        files: [{ path: "a.js", size_bytes: 1 }],
        total_bytes: (entry("js-total").limit_kb - 1) * 1000,
        max_bytes: (entry("js-largest-chunk").limit_kb - 1) * 1000,
      },
      {
        files: [{ path: "a.css", size_bytes: 1 }],
        total_bytes: (entry("css-total").limit_kb - 1) * 1000,
        max_bytes: 1,
      },
    ];
    expect(violations(budget, within)).toEqual([]);
    const bloated = within.map((m) => ({
      ...m,
      total_bytes: m.total_bytes + 200_000,
      max_bytes: m.max_bytes + 200_000,
    }));
    expect(violations(budget, bloated)).toHaveLength(3);
  });

  it("chưa build (không thấy tệp) cũng là vi phạm, không im lặng xanh", () => {
    const none = budget.map(() => ({
      files: [],
      total_bytes: 0,
      max_bytes: 0,
    }));
    expect(violations(budget, none)).toHaveLength(budget.length);
  });
});

describe("chỉ số hiệu năng chính và phân vị (XC-PERF-001, XC-PERF-004)", () => {
  it("PROJECT.md có mục Hiệu năng với chỉ số có số, điều kiện đo và nơi đo", () => {
    const t = read("PROJECT.md");
    const sec = /^### Hiệu năng\n([\s\S]*?)(?=^## |^### |$(?![\s\S]))/m.exec(t);
    expect(sec).not.toBeNull();
    expect(sec![1]).toMatch(/LCP[^|]*\|\s*≤ 2,5 s/);
    expect(sec![1]).toMatch(/p95 ≤ \d+ ms/);
    expect(sec![1]).toMatch(/Điều kiện đo/);
  });

  it("độ trễ báo bằng histogram phân vị; ngưỡng không dùng trung bình", () => {
    const m = read("src/observability/metrics.ts");
    expect(m).toContain("http_server_request_duration_seconds");
    expect(m).toMatch(/_bucket\{/);
    expect(read("docs/PERF-BUDGET.md")).toMatch(/p50\/p95\/p99/);
    expect(read("PROJECT.md")).not.toMatch(/avg\s*</i);
  });
});
