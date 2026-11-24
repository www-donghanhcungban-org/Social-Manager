import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * MUST nhóm bí mật (T-516): mỗi `it` nêu ID nó giữ. Blueprint tick kèm
 * `— Kiểm: npx vitest run tests/config/secrets.test.ts`.
 * Quét toàn lịch sử bằng gitleaks chạy ở CI (`secret-scan.yml`, check bắt buộc `gitleaks`);
 * test này giữ cấu hình đó và quét cây làm việc bằng mẫu khoá phổ biến.
 */
const read = (f: string) => readFileSync(f, "utf-8");

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("không bí mật trong repo (BASE-SEC-002, SEC-SECRET-001)", () => {
  it("cây làm việc không chứa khoá AWS hay private key (ngoài tests/)", () => {
    let out = "";
    try {
      out = execFileSync(
        "git",
        [
          "grep",
          "-nEI",
          "AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----",
          "--",
          ".",
          ":!tests",
          // Mã công cụ của khung chứa mẫu NHẬN DIỆN khoá (bộ che/quét), không phải khoá thật.
          ":!.xtemplates",
          ":!.claude/hooks",
        ],
        { encoding: "utf-8" },
      );
    } catch (e) {
      // git grep thoát 1 khi không khớp — đó là kết quả mong muốn.
      expect((e as { status?: number }).status).toBe(1);
    }
    expect(out).toBe("");
  });

  it("job gitleaks quét toàn lịch sử, không continue-on-error, và là check bắt buộc của ruleset", () => {
    const wf = read(".github/workflows/secret-scan.yml");
    expect(wf).toMatch(/fetch-depth:\s*0/);
    expect(wf).toMatch(/--log-opts='--all /);
    expect(wf).toMatch(/gitleaks"? git --redact/);
    expect(wf).not.toMatch(/continue-on-error/);
    expect(read(".github/rulesets/main.json")).toContain('"gitleaks"');
  });

  it("Dockerfile không có ARG/ENV chứa bí mật", () => {
    const bad = read("Dockerfile")
      .split("\n")
      .filter((l) =>
        /^\s*(ARG|ENV)\s+\S*(SECRET|PASSWORD|TOKEN|API_KEY)/i.test(l),
      );
    expect(bad).toEqual([]);
  });
});

describe("bí mật không lọt vào log (SEC-SECRET-007, DB-SEC-004)", () => {
  it("SEC-SECRET-007: logger che theo tên trường, chuỗi kết nối và query string (tests/log/logger.test.ts)", () => {
    const src = read("src/log/logger.ts");
    expect(src).toMatch(/SENSITIVE_KEY/);
    expect(src).toMatch(/CONNECTION_PASSWORD/);
    expect(src).toMatch(/QUERY_SECRET/);
    expect(read("tests/log/logger.test.ts")).toMatch(/SEC-SECRET-007/);
  });

  it("DB-SEC-004: compose không bật log_statement=all/log mọi truy vấn", () => {
    const c = read("docker-compose.yml");
    expect(c).not.toMatch(/log_statement\s*[=:]?\s*['"]?all/i);
    expect(c).not.toMatch(/log_min_duration_statement\s*[=:]?\s*['"]?0\b/);
  });
});

describe("quy trình khi lộ bí mật (SEC-SECRET-011)", () => {
  const rb = read("docs/RUNBOOK.md");
  const section = rb.slice(
    rb.indexOf("### Lộ bí mật"),
    rb.indexOf("### Tắt worker nền"),
  );

  it("RUNBOOK có mục Lộ bí mật với lệnh thu hồi cho từng loại khoá", () => {
    expect(rb).toContain("### Lộ bí mật");
    for (const k of [
      "POSTGRES_PASSWORD",
      "BETTER_AUTH_SECRET",
      "APP_SECRET_KEY",
      "SocialAPI",
      "Token GitHub",
    ])
      expect(section, k).toContain(k);
    expect(section).toContain("ALTER USER");
    expect(section).toMatch(/thu hồi/);
  });

  it("mục đó yêu cầu rà log, ghi sự cố và post-mortem; không chỉ xoá commit", () => {
    expect(section).toContain("docs/ops/incident-response.md");
    expect(section).toMatch(/post-mortem/);
    expect(section).toMatch(/docker compose logs/);
    expect(section).toMatch(/xoá commit không đủ/);
    expect(existsSync("docs/ops/incident-response.md")).toBe(true);
  });
});

describe("khoá nhà cung cấp chỉ ở server (AI-APP-008)", () => {
  it("file client (`use client`) không đụng env/bí mật và không có biến NEXT_PUBLIC_ chứa khoá", () => {
    const clientFiles = [...walk("app"), ...walk("src")]
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => /^\s*["']use client["']/m.test(read(f)));
    expect(clientFiles.length).toBeGreaterThan(0);
    for (const f of clientFiles)
      expect(read(f), f).not.toMatch(
        /AI_API_KEY|APP_SECRET_KEY|BETTER_AUTH_SECRET|DATABASE_URL|process\.env|config\/env/,
      );
    for (const f of [
      ...walk("app"),
      ...walk("src"),
      "docker-compose.yml",
      "Dockerfile",
    ].filter((f) => !f.endsWith(".md") && !statSync(f).isDirectory()))
      expect(read(f), f).not.toMatch(
        /NEXT_PUBLIC_[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD)/,
      );
  });
});

describe("hướng dẫn agent sạch (XC-DOCAI-005, LOOP-FB-003)", () => {
  const instr = [
    "AGENTS.md",
    "CLAUDE.md",
    ".claude/settings.json",
    ...walk(".claude/skills").filter((f) => f.endsWith(".md")),
  ];

  it("XC-DOCAI-005: không lệnh tải-và-chạy, không tên model/URL phiên trong file hướng dẫn", () => {
    for (const f of instr) {
      const t = read(f);
      expect(t, f).not.toMatch(/curl[^\n|]*\|\s*(ba)?sh/);
      expect(t, f).not.toMatch(/wget[^\n|]*\|\s*(ba)?sh/);
      expect(t, f).not.toMatch(/claude\.ai\/code\/session_/);
    }
  });

  it("XC-DOCAI-005: CODEOWNERS có dòng cho CLAUDE.md, AGENTS.md và .claude/", () => {
    const co = read(".github/CODEOWNERS");
    for (const p of ["/CLAUDE.md", "/AGENTS.md", "/.claude/"])
      expect(co, p).toMatch(
        new RegExp(`^${p.replace(/[./]/g, "\\$&")}\\s+@`, "m"),
      );
  });

  it("LOOP-FB-003: thư mục phản hồi khung (nếu có) không chứa mẫu khoá/token", () => {
    const files = walk("docs/xtemplates-feedback");
    for (const f of files)
      expect(read(f), f).not.toMatch(
        /AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{20,}/,
      );
  });
});

describe("không bí mật/tài khoản mặc định trong compose và mã (OPS-IAC-004, SEC-INFRA-010)", () => {
  const compose = read("docker-compose.yml");
  const envLines = compose
    .split("\n")
    .filter((l) => /(PASSWORD|SECRET|TOKEN|API_KEY)\b/.test(l))
    .filter((l) => !/^\s*#/.test(l));

  it("OPS-IAC-004: mọi giá trị nhạy cảm trong compose lấy từ biến, không có literal", () => {
    expect(envLines.length).toBeGreaterThan(0);
    for (const l of envLines) expect(l, l).toMatch(/\$\{[A-Z_]+/);
    // Không có thư mục IaC riêng (infra/, *.tf) chứa `password = "…"`.
    expect(existsSync("infra")).toBe(false);
    expect(
      walk(".").filter((f) => f.endsWith(".tf") && !f.includes("node_modules")),
    ).toEqual([]);
  });

  it("SEC-INFRA-010: mật khẩu CSDL bắt buộc đặt (`:?`), CSDL không publish cổng, không dịch vụ quản trị", () => {
    expect(compose).toMatch(/POSTGRES_PASSWORD:\s*\$\{POSTGRES_PASSWORD:\?/);
    const db = compose.slice(
      compose.indexOf("  db:"),
      compose.indexOf("  app:"),
    );
    expect(db).not.toMatch(/^\s*ports:/m);
    expect(compose).not.toMatch(
      /pgadmin|adminer|grafana|prometheus|pg-boss-dashboard/i,
    );
  });

  it("SEC-INFRA-010: /metrics chỉ tồn tại khi đóng mặc định và có Bearer; không seed tài khoản/mật khẩu mặc định trong mã", () => {
    // T-523 (OPS-OBS-003): route metrics được thêm, nhưng không bao giờ mở công khai — phải qua checkMetricsAccess
    // (404 khi chưa đặt METRICS_TOKEN, 401 khi sai Bearer). Test hành vi: tests/server/metrics.test.ts.
    if (existsSync("app/api/metrics/route.ts")) {
      const r = read("app/api/metrics/route.ts");
      expect(r).toContain("checkMetricsAccess");
      expect(r).toMatch(/disabled[\s\S]*404/);
    }
    const src = [...walk("src"), ...walk("app")].filter((f) =>
      /\.(ts|tsx)$/.test(f),
    );
    for (const f of src) {
      const t = read(f);
      expect(t, f).not.toMatch(
        /password\s*[:=]\s*["'](admin|password|123456|changeme|postgres)["']/i,
      );
      expect(t, f).not.toMatch(/admin@|admin\/admin/i);
    }
  });
});
