/**
 * Nghiệm thu F-005 — Triển khai tự host bằng Docker Compose (docs/specs/F-005-self-host-deploy.md).
 * Viết từ SPEC; kiểm tệp triển khai công khai (Dockerfile, docker-compose.yml, .dockerignore, scripts/), cấu hình
 * khởi động (`loadEnv`, `loadEnvOrExit`), kiểm sống (`checkHealth`) và migration trên PGlite thật. Không cần Docker, mạng.
 *
 * Không phủ bằng nghiệm thu tự động:
 * - AC-01 (phần chạy thật `docker compose up --build`): cần Docker daemon; chỉ kiểm cấu hình cam kết thứ tự
 *   db healthy -> migrate -> nghe cổng.
 * - AC-03 (phần "container chạy"): cần image dựng thật; chỉ kiểm Dockerfile.
 * - AC-08 (phần diễn tập khôi phục thật và pg_dump thành công): cần Postgres và pg_dump thật; chỉ kiểm đường thất bại
 *   của backup.sh, tài liệu RUNBOOK và bản ghi diễn tập.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";

import { loadEnv, loadEnvOrExit } from "@/src/config/env";
import { checkHealth } from "@/src/http/health";
import * as schema from "@/src/db/schema";

import { MIGRATIONS, createTestDb, tableNames } from "../db/helpers";

const ROOT = join(MIGRATIONS, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const dockerfile = read("Dockerfile");
const compose = read("docker-compose.yml");

/** Chỉ các dòng không phải chú thích. */
const code = (s: string) =>
  s
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

const GOOD_ENV = {
  DATABASE_URL: "postgres://social:pw@db:5432/social",
  BETTER_AUTH_SECRET: "s".repeat(40),
  BETTER_AUTH_URL: "https://app.example.com",
  APP_SECRET_KEY: Buffer.alloc(32, 1).toString("base64"),
};

function startup(env: Record<string, string | undefined>) {
  let stderr = "";
  let exitCode: number | undefined;
  try {
    loadEnvOrExit(env, {
      exit: (c) => {
        exitCode = c;
        throw new Error("exit");
      },
      stderr: (t) => {
        stderr += t;
      },
    });
  } catch {
    // exit giả ném để dừng luồng
  }
  return { stderr, exitCode };
}

describe("F-005 Triển khai tự host", () => {
  it("F-005/AC-01: app chỉ khởi động khi db qua healthcheck pg_isready", () => {
    const c = code(compose);
    expect(c).toMatch(/pg_isready/);
    expect(c).toMatch(
      /depends_on:\s*\n\s+db:\s*\n\s+condition:\s*service_healthy/,
    );
  });

  it("F-005/AC-01: container chạy migrate xong rồi mới exec next start", () => {
    const cmd = code(dockerfile)
      .split("\n")
      .filter((l) => /^\s*CMD\b/.test(l))
      .join("\n");
    expect(cmd).toMatch(
      /node scripts\/migrate\.mjs\s*&&\s*exec\s+\S*next start/,
    );
  });

  it("F-005/AC-02: chạy lại migrator không áp lại migration nào, sổ và bảng giữ nguyên", async () => {
    const { client, db } = await createTestDb();
    const count = async () =>
      (
        await client.query<{ n: number }>(
          "select count(*)::int as n from drizzle.__drizzle_migrations",
        )
      ).rows[0]!.n;
    const journal = JSON.parse(read("drizzle/meta/_journal.json")) as {
      entries: unknown[];
    };
    const before = await count();
    const tablesBefore = await tableNames(client);
    expect(before).toBe(journal.entries.length);

    await migrate(db, { migrationsFolder: MIGRATIONS });
    await migrate(drizzle(client, { schema }), {
      migrationsFolder: MIGRATIONS,
    });

    expect(await count()).toBe(before);
    expect(await tableNames(client)).toEqual(tablesBefore);
    await client.close();
  });

  it("F-005/AC-02: mỗi migration có tệp .down.sql", () => {
    const files = readdirSync(MIGRATIONS);
    const ups = files.filter(
      (f) => f.endsWith(".sql") && !f.endsWith(".down.sql"),
    );
    expect(ups.length).toBeGreaterThan(0);
    for (const up of ups) {
      expect(files, `thiếu down cho ${up}`).toContain(
        up.replace(/\.sql$/, ".down.sql"),
      );
    }
  });

  it("F-005/AC-03: tầng cuối có USER node (không root) trước CMD, chown dữ liệu trước USER, không sudo", () => {
    const stage = code(dockerfile)
      .split(/^FROM /m)
      .pop()!;
    const lines = stage.split("\n");
    const userIdx = lines.findIndex((l) => /^\s*USER\s+/.test(l));
    const cmdIdx = lines.findIndex((l) => /^\s*CMD\b/.test(l));
    const chownIdx = lines.findIndex((l) => /chown\b.*\/data/.test(l));
    expect(userIdx).toBeGreaterThanOrEqual(0);
    expect(lines[userIdx]).toMatch(/^\s*USER\s+node\s*$/);
    expect(cmdIdx).toBeGreaterThan(userIdx);
    expect(chownIdx).toBeGreaterThanOrEqual(0);
    expect(chownIdx).toBeLessThan(userIdx);
    expect(stage).not.toMatch(/\bsudo\b/);
    expect(stage).not.toMatch(/^\s*USER\s+(root|0)\b/m);
  });

  it.each([
    "POSTGRES_PASSWORD",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "APP_SECRET_KEY",
  ])("F-005/AC-04: compose dừng ngay khi thiếu %s", (name) => {
    expect(code(compose)).toMatch(new RegExp(`\\$\\{${name}:\\?`));
  });

  it("F-005/AC-04: cấu hình đủ và đúng thì khởi động được", () => {
    expect(() => loadEnv(GOOD_ENV)).not.toThrow();
    expect(startup(GOOD_ENV).exitCode).toBeUndefined();
  });

  it.each([
    ["BETTER_AUTH_SECRET", undefined],
    ["BETTER_AUTH_SECRET", ""],
    ["BETTER_AUTH_SECRET", "    "],
    ["BETTER_AUTH_SECRET", "ngan"],
    ["BETTER_AUTH_URL", undefined],
    ["BETTER_AUTH_URL", ""],
    ["BETTER_AUTH_URL", "http://app.example.com"],
    ["APP_SECRET_KEY", undefined],
    ["APP_SECRET_KEY", ""],
    ["APP_SECRET_KEY", Buffer.alloc(16, 1).toString("base64")],
    ["APP_SECRET_KEY", Buffer.alloc(48, 1).toString("base64")],
    ["APP_SECRET_KEY", "khong-phai-base64!"],
  ])(
    "F-005/AC-04: %s = %j bị từ chối, in tên biến, thoát mã 1, không in giá trị",
    (key, value) => {
      const env: Record<string, string | undefined> = {
        ...GOOD_ENV,
        [key]: value,
      };
      const { stderr, exitCode } = startup(env);
      expect(exitCode).toBe(1);
      expect(stderr).toContain(key);
      if (value && value.trim() !== "") expect(stderr).not.toContain(value);
    },
  );

  it("F-005/AC-04: nhiều biến sai cùng lúc thì in tên MỌI biến sai, không lộ giá trị", () => {
    const secret = "bi-mat-ngan";
    const { stderr, exitCode } = startup({
      ...GOOD_ENV,
      BETTER_AUTH_SECRET: secret,
      BETTER_AUTH_URL: "",
      APP_SECRET_KEY: "sai",
    });
    expect(exitCode).toBe(1);
    for (const k of ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "APP_SECRET_KEY"])
      expect(stderr).toContain(k);
    expect(stderr).not.toContain(secret);
  });

  it("F-005/AC-05: .dockerignore loại .env*, .git và *.pem", () => {
    const lines = read(".dockerignore")
      .split("\n")
      .map((l) => l.trim());
    expect(lines).toContain(".git");
    expect(lines).toContain("*.pem");
    expect(lines.some((l) => l === ".env" || l === ".env*")).toBe(true);
    expect(lines.some((l) => l === ".env.*" || l === ".env*")).toBe(true);
  });

  it("F-005/AC-05: không mật khẩu mặc định và không cờ tắt xác minh TLS trong cấu hình", () => {
    const all = code(compose) + "\n" + code(dockerfile);
    // Biến bắt buộc không có giá trị mặc định.
    expect(all).not.toMatch(
      /\$\{(POSTGRES_PASSWORD|BETTER_AUTH_SECRET|APP_SECRET_KEY)[:-]-/,
    );
    expect(all).not.toMatch(/POSTGRES_PASSWORD:\s*["']?[A-Za-z0-9]+["']?\s*$/m);
    expect(all).not.toMatch(/NODE_TLS_REJECT_UNAUTHORIZED/i);
    expect(all).not.toMatch(/rejectUnauthorized/i);
    expect(all).not.toMatch(/--insecure|sslmode=disable/i);
  });

  it("F-005/AC-05: AI và gửi tin thật mặc định tắt", () => {
    expect(code(compose)).toMatch(/AI_BASE_URL:\s*\$\{AI_BASE_URL:-\}/);
    expect(code(compose)).toMatch(
      /OUTBOUND_LIVE:\s*\$\{OUTBOUND_LIVE:-false\}/,
    );
    const env = loadEnv(GOOD_ENV);
    expect(env.OUTBOUND_LIVE).toBe("false");
    expect(env.AI_BASE_URL).toBeUndefined();
  });

  it("F-005/AC-06: CSDL trả lời thì 200 ok", async () => {
    const r = await checkHealth(async () => {}, 1000);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: "ok" });
  });

  it("F-005/AC-06: CSDL lỗi thì 503 degraded, không lộ chi tiết lỗi", async () => {
    const r = await checkHealth(async () => {
      throw new Error(
        "password authentication failed for user social@10.0.0.5",
      );
    }, 1000);
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ status: "degraded" });
    expect(JSON.stringify(r)).not.toMatch(/password|social|10\.0\.0\.5/);
  });

  it("F-005/AC-06: CSDL treo quá hạn thì 503 degraded, không treo theo", async () => {
    const started = Date.now();
    const r = await checkHealth(() => new Promise<void>(() => {}), 50);
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ status: "degraded" });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("F-005/AC-06: image có HEALTHCHECK gọi /api/health", () => {
    expect(code(dockerfile)).toMatch(/HEALTHCHECK[\s\S]*\/api\/health/);
  });

  it("F-005/AC-07: mọi cổng publish trong compose chỉ ra 127.0.0.1, không publish 5432", () => {
    const c = code(compose);
    const blocks = [...c.matchAll(/ports:\s*\n((?:\s+-\s+.*\n?)+)/g)];
    expect(blocks.length).toBeGreaterThan(0);
    const entries = blocks.flatMap((b) =>
      b[1]!
        .split("\n")
        .map((l) =>
          l
            .replace(/^\s*-\s*/, "")
            .replace(/["']/g, "")
            .trim(),
        )
        .filter(Boolean),
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(e).toMatch(/^127\.0\.0\.1:/);
    expect(
      entries.some((e) => /(^|:)5432(:|$)/.test(e.replace("127.0.0.1:", ""))),
    ).toBe(false);
    expect(c).not.toMatch(/0\.0\.0\.0:\d+/);
  });

  it("F-005/AC-07: npm start ngoài container bind loopback", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.start).toMatch(/-H\s+(127\.0\.0\.1|localhost)\b/);
  });

  describe("F-005/AC-08 sao lưu và khôi phục", () => {
    const backup = read("scripts/backup.sh");

    it("F-005/AC-08: backup.sh đọc lại dump để kiểm, có băm và xoay vòng", () => {
      expect(backup).toMatch(/pg_restore\s+--list/);
      expect(backup).toMatch(/sha256sum/);
      expect(backup).toMatch(/BACKUP_KEEP/);
    });

    it("F-005/AC-08: thiếu DATABASE_URL thì backup.sh thoát khác 0", () => {
      const r = spawnSync("bash", [join(ROOT, "scripts/backup.sh")], {
        env: { PATH: process.env.PATH ?? "", HOME: tmpdir(), NODE_ENV: "test" },
        encoding: "utf8",
      });
      expect(r.status).not.toBe(0);
    });

    it("F-005/AC-08: sao lưu thất bại thoát khác 0 và để lại dấu vết FAILED", () => {
      const dir = mkdtempSync(join(tmpdir(), "xw-backup-"));
      const r = spawnSync("bash", [join(ROOT, "scripts/backup.sh")], {
        env: {
          PATH: process.env.PATH ?? "",
          HOME: tmpdir(),
          NODE_ENV: "test",
          DATABASE_URL: "postgres://u@127.0.0.1:1/none",
          BACKUP_DIR: dir,
        },
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(r.status).not.toBe(0);
      expect(existsSync(join(dir, "FAILED"))).toBe(true);
      expect(readdirSync(dir).some((f) => f.startsWith("SHA256SUMS-"))).toBe(
        false,
      );
    });

    it("F-005/AC-08: restore-drill.sh không chạy khi thiếu đối số và có bản ghi diễn tập trong tài liệu", () => {
      const r = spawnSync("bash", [join(ROOT, "scripts/restore-drill.sh")], {
        env: { PATH: process.env.PATH ?? "", HOME: tmpdir(), NODE_ENV: "test" },
        encoding: "utf8",
      });
      expect(r.status).not.toBe(0);
      const runbook = read("docs/RUNBOOK.md");
      expect(runbook).toContain("scripts/backup.sh");
      expect(runbook).toContain("scripts/restore-drill.sh");
      const drills = read("docs/ops/restore-drills.md");
      expect(drills).toMatch(/^\|\s*\d{4}-\d{2}-\d{2}\s*\|/m);
    });
  });
});
