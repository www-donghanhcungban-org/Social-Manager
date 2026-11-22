import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf-8");
const pkg = JSON.parse(read("package.json")) as {
  scripts: Record<string, string>;
};
const tracked = () =>
  execFileSync("git", ["ls-files", "-z"], { encoding: "utf-8" })
    .split("\0")
    .filter(Boolean);

describe("năm lệnh chuẩn (BASE-GATE-001)", () => {
  const xt = read("xt.yaml");
  it.each([
    ["format", "format"],
    ["lint", "lint"],
    ["typecheck", "type-check"],
    ["test", "test"],
    ["build", "build"],
  ])("`%s` có trong xt.yaml và trỏ tới script npm có thật", (key, script) => {
    const m = new RegExp(`^${key}:\\s*"npm (?:run )?${script}"`, "m").exec(xt);
    expect(m, `xt.yaml thiếu ${key}`).not.toBeNull();
    expect(
      pkg.scripts[script],
      `package.json thiếu script ${script}`,
    ).toBeTruthy();
  });
});

describe("cổng chất lượng nghiêm (BASE-GATE-003/004)", () => {
  it("lint coi cảnh báo là lỗi (--max-warnings 0)", () => {
    expect(pkg.scripts.lint).toMatch(/--max-warnings(=|\s+)0/);
  });

  it("không có eslint-disable/@ts-ignore nào thiếu lý do tại chỗ", () => {
    const hits = tracked()
      .filter(
        (f) =>
          /\.(ts|tsx|mts|mjs|js)$/.test(f) && !f.startsWith(".xtemplates/"),
      )
      .flatMap((f) =>
        read(f)
          .split("\n")
          .map((line, i) => ({ f, line, n: i + 1 }))
          .filter(
            ({ line }) =>
              /eslint-disable|@ts-ignore|@ts-nocheck|@ts-expect-error/.test(
                line,
              ) &&
              !/(--|—|:)\s*\S{6,}/.test(
                line.replace(/^.*?(eslint-disable[\w-]*|@ts-\w+[\w-]*)/, ""),
              ),
          )
          // chính file này nhắc các chuỗi trên làm ví dụ
          .filter(({ f }) => f !== "tests/config/gates.test.ts"),
      );
    expect(hits).toEqual([]);
  });

  it("TypeScript strict bật", () => {
    const ts = JSON.parse(read("tsconfig.json")) as {
      compilerOptions: { strict?: boolean };
    };
    expect(ts.compilerOptions.strict).toBe(true);
  });
});

describe("mã hoá UTF-8 (BASE-DATA-001)", () => {
  it(".editorconfig khai charset = utf-8", () => {
    expect(read(".editorconfig")).toMatch(/^charset\s*=\s*utf-8$/m);
  });

  it("mọi file văn bản trong git là UTF-8 hợp lệ, không BOM", () => {
    const textExt = /\.(ts|tsx|mts|mjs|js|json|md|css|sql|yml|yaml|txt|sh|py)$/;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const bad: string[] = [];
    for (const f of tracked().filter((f) => textExt.test(f))) {
      const buf = readFileSync(f);
      try {
        decoder.decode(buf);
      } catch {
        bad.push(`${f}: không phải UTF-8`);
      }
      if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf)
        bad.push(`${f}: có BOM`);
    }
    expect(bad).toEqual([]);
  });
});

describe("thời gian luôn có múi giờ (BASE-DATA-006)", () => {
  it("schema và migration không dùng `timestamp` không múi giờ", () => {
    const schema = read("src/db/schema.ts") + read("src/db/auth-schema.ts");
    // mọi lời gọi timestamp(...) phải kèm withTimezone: true
    const calls = schema.match(/timestamp\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c, c).toContain("withTimezone: true");

    const sql = tracked()
      .filter(
        (f) => /^drizzle\/\d+_.*\.sql$/.test(f) && !f.endsWith(".down.sql"),
      )
      .map(read)
      .join("\n");
    expect(sql).not.toMatch(/timestamp(?!\s+with time zone)\b(?!tz)/i);
  });

  it("mã ứng dụng không lưu/trao đổi thời điểm bằng chuỗi cục bộ (toString/toLocale*)", () => {
    const offenders = tracked()
      .filter((f) => /^(src|app)\/.*\.(ts|tsx)$/.test(f))
      .filter(
        (f) =>
          /\.toString\(\)|toLocale(Date|Time)?String/.test(read(f)) &&
          /new Date\([^)]*\)\.(toString|toLocale\w*)\(/.test(read(f)),
      );
    expect(offenders).toEqual([]);
  });
});
