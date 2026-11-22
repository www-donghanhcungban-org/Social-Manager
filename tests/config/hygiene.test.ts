import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");

/** Mã ứng dụng (không gồm test): thư mục src, app và các file gốc chạy trên server. */
function appFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|mts)$/.test(name)) out.push(full);
    }
  };
  walk(join(ROOT, "src"));
  walk(join(ROOT, "app"));
  out.push(join(ROOT, "instrumentation.ts"));
  return out;
}

const rel = (f: string) => relative(ROOT, f);

describe("vệ sinh cấu hình (BASE-CFG-001/002)", () => {
  it("chỉ src/config/env.ts được đọc process.env", () => {
    const offenders = appFiles()
      .filter((f) => rel(f) !== "src/config/env.ts")
      .filter((f) => /process\.env\b/.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("mã ứng dụng không chứa URL CSDL kèm mật khẩu hay khoá bí mật dạng literal", () => {
    const patterns = [
      /postgres(ql)?:\/\/[^\s"'`/:@]+:[^\s"'`/@]+@/, // postgres://user:pass@host
      /\bsk_live_[A-Za-z0-9]+/,
      /\bAKIA[0-9A-Z]{16}\b/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    ];
    const offenders = appFiles()
      .filter((f) => patterns.some((p) => p.test(readFileSync(f, "utf8"))))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
