import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf-8");
const tracked = () =>
  execFileSync("git", ["ls-files", "-z"], { encoding: "utf-8" })
    .split("\0")
    .filter(Boolean);
const sourceFiles = () =>
  tracked().filter((f) =>
    /^(app|src|proxy|instrumentation)[./].*\.(ts|tsx)$|^(proxy|instrumentation)\.ts$/.test(
      f,
    ),
  );

describe("env công khai không chứa bí mật (PRF-WEB-003)", () => {
  it("không có biến NEXT_PUBLIC_/VITE_/PUBLIC_ mang tên SECRET|KEY|TOKEN|PASSWORD", () => {
    const re =
      /\b(?:NEXT_PUBLIC|VITE|PUBLIC)_[A-Z0-9_]*(SECRET|KEY|TOKEN|PASSWORD)[A-Z0-9_]*/;
    const hits = tracked()
      .filter(
        (f) =>
          /\.(ts|tsx|mjs|js|json|ya?ml|md|example)$/.test(f) &&
          !f.startsWith(".xtemplates/") &&
          !f.startsWith("docs/") &&
          f !== "tests/config/web-hygiene.test.ts" &&
          f !== "package-lock.json",
      )
      .filter((f) => re.test(read(f)));
    expect(hits).toEqual([]);
  });

  it("config đọc env qua schema Zod và fail-closed khi thiếu", () => {
    const env = read("src/config/env.ts");
    expect(env).toMatch(/from "zod"/);
    expect(env).toMatch(/ConfigError/);
  });
});

describe("không dùng GET để đổi trạng thái (SEC-WEB-007)", () => {
  it("route handler GET chỉ là cổng Better Auth (đọc phiên/callback), không tự ghi", () => {
    const withGet = sourceFiles().filter((f) =>
      /export\s+(async\s+)?function\s+GET\b|export\s+const\s+GET\b/.test(
        read(f),
      ),
    );
    // health: chỉ `select 1`, không ghi, không dữ liệu người dùng
    expect(withGet).toEqual([
      "app/api/auth/[...all]/route.ts",
      "app/api/health/route.ts",
    ]);
  });

  it("mọi thao tác ghi trong app/ là Server Action ('use server', chỉ POST)", () => {
    const actions = sourceFiles().filter((f) =>
      /^app\/.*\/actions\.ts$/.test(f),
    );
    expect(actions.length).toBeGreaterThan(0);
    for (const f of actions) expect(read(f), f).toMatch(/^"use server"/m);
  });
});
