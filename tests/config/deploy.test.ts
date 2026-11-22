import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { loadEnv } from "@/src/config/env";

const read = (p: string) => readFileSync(p, "utf-8");
const tracked = () =>
  execFileSync("git", ["ls-files", "-z"], { encoding: "utf-8" })
    .split("\0")
    .filter(Boolean);
const own = (f: string) =>
  !f.startsWith(".xtemplates/") && !f.startsWith(".claude/");

describe("container chạy không bằng root (BASE-SEC-006)", () => {
  const lines = read("Dockerfile").split("\n");

  it("tầng cuối có USER không phải root, đặt trước CMD", () => {
    const user = lines.findLastIndex((l) => /^USER\s+/.test(l));
    const cmd = lines.findLastIndex((l) => /^CMD\s+/.test(l));
    expect(user).toBeGreaterThan(-1);
    expect(user).toBeLessThan(cmd);
    const who = lines[user]!.replace(/^USER\s+/, "").trim();
    expect(who).not.toMatch(/^(root|0)(:|$)/);
  });

  it("không dùng sudo trong script runtime", () => {
    for (const f of ["Dockerfile", "scripts/migrate.mjs", "docker-compose.yml"])
      expect(read(f), f).not.toMatch(/\bsudo\b/);
  });

  it(".dockerignore giữ bí mật và lịch sử ngoài image", () => {
    const ignore = read(".dockerignore").split("\n");
    for (const p of [".git", ".env", ".env.*", "*.pem", "node_modules"])
      expect(ignore, p).toContain(p);
  });
});

describe("cổng mạng (BASE-SEC-010)", () => {
  const compose = read("docker-compose.yml");
  const ports = [...compose.matchAll(/^\s+-\s+"?([0-9.:]+:\d+)"?\s*$/gm)].map(
    (m) => m[1]!,
  );

  it("mọi cổng publish trong compose chỉ ra 127.0.0.1", () => {
    expect(ports.length).toBeGreaterThan(0);
    for (const p of ports) expect(p, p).toMatch(/^127\.0\.0\.1:/);
  });

  it("không publish cổng CSDL (5432) ra host", () => {
    expect(compose).not.toMatch(/:5432"?\s*$/m);
    const db = /^ {2}db:\n([\s\S]*?)(?=^ {2}\S|^\S|(?![\s\S]))/m.exec(compose);
    expect(db, "thiếu service db").not.toBeNull();
    expect(db![1]).not.toMatch(/^\s*ports:/m);
  });

  it("`npm start` ngoài container bind loopback; chỉ CMD của container mới 0.0.0.0", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.start).toMatch(/-H\s+127\.0\.0\.1/);
    expect(read("Dockerfile")).toMatch(/-H 0\.0\.0\.0/);
  });

  it("README/tài liệu không hướng dẫn `docker run -p` mở ra mọi interface", () => {
    const hits = tracked()
      // BLUEPRINT*.md trích nguyên văn câu quy tắc nên không phải hướng dẫn chạy
      .filter((f) => f.endsWith(".md") && own(f) && !/^BLUEPRINT/.test(f))
      .flatMap((f) =>
        read(f)
          .split("\n")
          .filter(
            (l) => /docker run/.test(l) && /(-p|--publish)[ =]\d+:\d+/.test(l),
          ),
      );
    expect(hits).toEqual([]);
  });
});

describe("không mặc định, không bí mật cứng, bắt buộc TLS ra ngoài (BASE-SEC-004/005)", () => {
  it("compose bắt buộc đặt bí mật: thiếu là dừng, không có giá trị mặc định", () => {
    const compose = read("docker-compose.yml");
    for (const v of [
      "POSTGRES_PASSWORD",
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
      "APP_SECRET_KEY",
    ])
      expect(compose, v).toMatch(new RegExp(`\\$\\{${v}:\\?`));
  });

  it("không có cặp tài khoản/mật khẩu mặc định trong mã và cấu hình", () => {
    const hits = tracked()
      .filter(
        (f) =>
          /\.(ts|tsx|mjs|js|ya?ml|json|sh)$/.test(f) &&
          own(f) &&
          !f.startsWith("tests/") &&
          !f.startsWith("e2e/") &&
          f !== "package-lock.json",
      )
      .filter((f) =>
        /\b(admin\/admin|admin:admin|root:root|password123|changeme)\b/i.test(
          read(f),
        ),
      );
    expect(hits).toEqual([]);
  });

  it("không có cờ tắt xác minh chứng chỉ TLS", () => {
    const re =
      /NODE_TLS_REJECT_UNAUTHORIZED\s*[=:]\s*["']?0|rejectUnauthorized\s*:\s*false|verify\s*=\s*False|InsecureSkipVerify/;
    const hits = tracked()
      .filter(
        (f) =>
          /\.(ts|tsx|mjs|js|ya?ml|json|sh|Dockerfile)$|^Dockerfile$/.test(f) &&
          own(f) &&
          f !== "tests/config/deploy.test.ts",
      )
      .filter((f) => re.test(read(f)));
    expect(hits).toEqual([]);
  });

  it("URL dịch vụ ngoài phải là https: http:// bị từ chối khi nạp cấu hình", () => {
    const base = {
      DATABASE_URL: "postgres://u:p@db:5432/x",
      BETTER_AUTH_SECRET: "x".repeat(40),
      BETTER_AUTH_URL: "https://app.example.com",
      APP_SECRET_KEY: randomBytes(32).toString("base64"),
    };
    expect(() =>
      loadEnv({ ...base, SOCIALAPI_BASE_URL: "http://api.example.com/v1" }),
    ).toThrow(/SOCIALAPI_BASE_URL/);
    expect(
      loadEnv({ ...base, SOCIALAPI_BASE_URL: "https://api.example.com/v1" })
        .SOCIALAPI_BASE_URL,
    ).toBe("https://api.example.com/v1");
  });
});

describe("tệp triển khai có đủ và khớp nhau", () => {
  it("Dockerfile chạy migrate trước khi nghe cổng và có healthcheck", () => {
    const d = read("Dockerfile");
    expect(d).toMatch(/node scripts\/migrate\.mjs && exec .*next start/);
    expect(d).toMatch(/^HEALTHCHECK/m);
    for (const f of ["scripts/migrate.mjs", "next.config.mjs", "drizzle"])
      expect(existsSync(f), f).toBe(true);
  });

  it("cấu hình Next không giấu lỗi build (PRF-WEB-002 một phần)", () => {
    expect(read("next.config.mjs")).not.toMatch(
      /ignoreBuildErrors|ignoreDuringBuilds/,
    );
  });
});
