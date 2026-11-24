// T-581 · cổng rollback (ADR-0062), phần CSDL: diễn tập quay về schema của bản phát hành trước TRÊN DỮ LIỆU.
// Mốc = các migration ghi trong drizzle/applied.sha256 (khoá của v1.0.0). Migration mới hơn mốc là thứ bản đang chạy
// mang thêm; lùi về bản trước = chạy .down.sql của chúng theo thứ tự ngược. Mọi migration đã nằm trong khoá thì
// diễn tập lùi migration cuối cùng (vẫn giữ được phép thử đường lùi).
// Kiểm: sổ __drizzle_migrations khớp đúng tập còn áp; schema sau lùi trùng schema dựng từ đầu tới mốc (thứ mã bản
// trước chờ đợi); dữ liệu bảng cũ còn nguyên; migrator thật tiến lại được mà không đụng dữ liệu đó.
// Phần artifact (image/tag cũ) chưa diễn tập ở đây — chờ đích deploy (T-541), xem docs/RUNBOOK.md §Rollback.
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseLock } from "../../scripts/check-migrations.mjs";

import { createTestDb, MIGRATIONS, readDownSql } from "./helpers";
import {
  comparable,
  expectedAfterDown,
  JOURNAL,
  journalWhens,
  project,
  seedAllTables,
  snapshot,
  type Snapshot,
  TAGS,
} from "./migration-fixtures";

const LOCK_TEXT = readFileSync(`${MIGRATIONS}/applied.sha256`, "utf8");
const LOCK = parseLock(LOCK_TEXT) as Map<string, string>;
const RELEASED = TAGS.filter((tag) => LOCK.has(`drizzle/${tag}.sql`));
const NEWER = TAGS.slice(RELEASED.length);
const ROLLBACK = NEWER.length > 0 ? NEWER : [TAGS.at(-1)!];
const KEEP = TAGS.length - ROLLBACK.length;

/** Schema rút gọn để so: cột (kiểu, null, mặc định), ràng buộc, index, hàm, trigger trong schema public. */
async function schemaOf(client: PGlite) {
  const q = async (sql: string) =>
    (await client.query<{ x: string }>(sql)).rows.map((r) => r.x);
  return {
    columns:
      await q(`select table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' ||
      coalesce(column_default, '') as x from information_schema.columns where table_schema = 'public' order by 1`),
    constraints:
      await q(`select c.conrelid::regclass::text || ':' || c.conname || ':' || pg_get_constraintdef(c.oid) as x
      from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public' order by 1`),
    indexes: await q(
      `select tablename || ':' || indexdef as x from pg_indexes where schemaname = 'public' order by 1`,
    ),
    functions:
      await q(`select p.proname as x from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' order by 1`),
    triggers:
      await q(`select tgrelid::regclass::text || ':' || tgname as x from pg_trigger
      where not tgisinternal order by 1`),
  };
}

let workDir: string;
let reference: Awaited<ReturnType<typeof schemaOf>>;
let t: Awaited<ReturnType<typeof createTestDb>>;
let head: Snapshot;
let afterDown: Snapshot;

beforeAll(async () => {
  // Schema "bản trước": dựng từ đầu bằng migrator thật với journal cắt tới mốc.
  workDir = mkdtempSync(join(tmpdir(), "xw-rollback-"));
  mkdirSync(join(workDir, "meta"));
  const journal = JSON.parse(
    readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8"),
  ) as { entries: unknown[] };
  writeFileSync(
    join(workDir, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, KEEP) }),
  );
  for (const tag of TAGS.slice(0, KEEP))
    copyFileSync(`${MIGRATIONS}/${tag}.sql`, join(workDir, `${tag}.sql`));
  const refClient = new PGlite();
  await migrate(drizzle(refClient), { migrationsFolder: workDir });
  reference = await schemaOf(refClient);
  await refClient.close();

  // Bản đang chạy (HEAD) có dữ liệu ở mọi bảng, rồi lùi về mốc.
  t = await createTestDb();
  await seedAllTables(t.client);
  head = await snapshot(t.client);
  for (const tag of [...ROLLBACK].reverse())
    await t.client.exec(readDownSql(tag));
  afterDown = await snapshot(t.client);
});

afterAll(async () => {
  await t?.client.close();
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe("diễn tập rollback CSDL về bản phát hành trước [T-581]", () => {
  it("mốc là khoá v1.0.0 và là tiền tố liền mạch của journal", () => {
    expect(LOCK_TEXT).toMatch(/v1\.0\.0/);
    expect(RELEASED.length).toBeGreaterThan(0);
    expect(TAGS.slice(0, RELEASED.length)).toEqual(RELEASED);
    // .down.sql của mọi migration đã phát hành cũng nằm trong khoá (đường lùi bất biến cùng migration).
    for (const tag of RELEASED)
      expect(LOCK.has(`drizzle/${tag}.down.sql`), tag).toBe(true);
    expect(ROLLBACK.length).toBeGreaterThan(0);
  });

  it("sổ __drizzle_migrations khớp đúng trạng thái đã lùi", async () => {
    expect(await journalWhens(t.client)).toEqual(
      JOURNAL.slice(0, KEEP).map((e) => e.when),
    );
  });

  it("schema sau lùi trùng schema dựng từ đầu tới mốc phát hành", async () => {
    expect(await schemaOf(t.client)).toEqual(reference);
  });

  it("dữ liệu bảng cũ còn nguyên: cùng số dòng và nội dung", () => {
    const pairs = comparable(head, afterDown);
    expect(pairs.length).toBe(afterDown.size);
    for (const { table, columns } of pairs) {
      const rows = afterDown.get(table)!.rows;
      expect(rows.length, `${table} còn dữ liệu`).toBeGreaterThan(0);
      expect(project(rows, columns), table).toEqual(
        project(
          expectedAfterDown(ROLLBACK, table, head.get(table)!.rows),
          columns,
        ),
      );
    }
  });

  it("migrator thật dựng lại HEAD mà không đụng dữ liệu đã giữ", async () => {
    await migrate(t.db, { migrationsFolder: MIGRATIONS });
    expect(await journalWhens(t.client)).toEqual(JOURNAL.map((e) => e.when));
    const up = await snapshot(t.client);
    expect([...up.keys()].sort()).toEqual([...head.keys()].sort());
    for (const { table, columns } of comparable(afterDown, up))
      expect(project(up.get(table)!.rows, columns), table).toEqual(
        project(afterDown.get(table)!.rows, columns),
      );
  });
});
