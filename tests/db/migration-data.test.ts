// T-580 · cổng migration_check (ADR-0062): lùi rồi tiến lại migration TRÊN DỮ LIỆU, không chỉ trên schema rỗng.
// Với mỗi migration N: dựng HEAD + dữ liệu ở mọi bảng → chạy .down.sql từ bản mới nhất lùi tới N (thứ tự ngược) →
// migrator thật dựng lại. Sau lùi và sau tiến, bảng có ở cả hai phía giữ nguyên số dòng và nội dung.
//
// Phần được phép mất (bản chất của đường lùi, đã ghi trong comment từng .down.sql): bảng do migration bị lùi TẠO RA
// và cột do nó THÊM VÀO. Test không bỏ qua chúng một cách lặng lẽ: tập bảng/cột còn lại phải đúng bằng HEAD trừ đúng
// những gì các migration bị lùi đã tạo (đọc từ chính file .sql), nên .down.sql xoá nhầm bảng/cột cũ là đỏ.
// Biến đổi dữ liệu cố ý duy nhất trên bảng còn lại: 0007 (xem `expectedAfterDown`).
import { readFileSync } from "node:fs";

import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, MIGRATIONS, readDownSql } from "./helpers";
import {
  comparable,
  expectedAfterDown,
  JOURNAL,
  journalWhens,
  project,
  seedAllTables,
  snapshot,
  TAGS,
} from "./migration-fixtures";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => {
  t = await createTestDb();
  await seedAllTables(t.client);
});
afterEach(async () => {
  await t.client.close();
});

const upSql = (tag: string) => readFileSync(`${MIGRATIONS}/${tag}.sql`, "utf8");
/** Bảng mà migration tạo ra. */
const createdTables = (tag: string) =>
  [...upSql(tag).matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]!);
/** Cột mà migration thêm vào bảng có sẵn: `bảng.cột`. */
const addedColumns = (tag: string) =>
  [...upSql(tag).matchAll(/ALTER TABLE "(\w+)" ADD COLUMN "(\w+)"/g)].map(
    (m) => `${m[1]}.${m[2]}`,
  );

describe("dữ liệu tổng hợp ở HEAD", () => {
  it("mọi bảng có ít nhất một dòng (bảng mới phải được thêm vào seedAllTables)", async () => {
    const head = await snapshot(t.client);
    expect([...head.keys()].sort()).toEqual(TAGS.flatMap(createdTables).sort());
    for (const [table, shot] of head)
      expect(shot.rows.length, `bảng ${table} chưa có dữ liệu`).toBeGreaterThan(
        0,
      );
  });
});

const MSG_LINK = "0011_evidence_message_link";

describe("lỗi đã biết của 0011.down.sql (D-034)", () => {
  it("lùi 0011 khi còn bằng chứng nguồn message thì tiến lại bị CHECK từ chối; sửa được thì xoá ca này và bỏ bước dọn ở trên", async () => {
    for (const tag of TAGS.slice(TAGS.indexOf(MSG_LINK)).reverse())
      await t.client.exec(readDownSql(tag));
    await expect(
      migrate(t.db, { migrationsFolder: MIGRATIONS }),
    ).rejects.toThrow();
  });
});

describe("lùi rồi tiến lại migration trên dữ liệu [T-580]", () => {
  it.each(TAGS.map((tag, i) => [tag, i] as const))(
    "lùi tới %s rồi migrator thật: bảng cũ giữ nguyên dòng và nội dung",
    async (_tag, index) => {
      const downed = TAGS.slice(index).reverse();
      // Lỗi đã biết D-034: 0011.down.sql bỏ cột message_id nhưng để lại dòng source='message' nên migrator không tiến lại
      // được. Quy trình lùi 0011 phải xoá chúng trước (RUNBOOK §Rollback); bảng chụp lấy SAU bước dọn đó.
      if (downed.includes(MSG_LINK))
        await t.client.exec(
          `DELETE FROM "evidence_items" WHERE "source" = 'message'`,
        );
      const head = await snapshot(t.client);
      for (const tag of downed) await t.client.exec(readDownSql(tag));

      // Sổ drizzle khớp đúng các migration còn áp (không chỉ đếm).
      expect(await journalWhens(t.client)).toEqual(
        JOURNAL.slice(0, index).map((e) => e.when),
      );

      const down = await snapshot(t.client);
      // Đúng những bảng/cột của migration bị lùi biến mất — không hơn.
      const goneTables = new Set(downed.flatMap(createdTables));
      const goneColumns = new Set(downed.flatMap(addedColumns));
      expect([...down.keys()].sort()).toEqual(
        [...head.keys()].filter((x) => !goneTables.has(x)).sort(),
      );
      for (const [table, shot] of down)
        expect(shot.columns, `cột của ${table} sau lùi`).toEqual(
          head
            .get(table)!
            .columns.filter((c) => !goneColumns.has(`${table}.${c}`)),
        );

      for (const { table, columns } of comparable(head, down)) {
        const before = expectedAfterDown(downed, table, head.get(table)!.rows);
        expect(
          project(down.get(table)!.rows, columns),
          `${table} sau khi lùi`,
        ).toEqual(project(before, columns));
      }

      await migrate(t.db, { migrationsFolder: MIGRATIONS });
      expect(await journalWhens(t.client)).toEqual(JOURNAL.map((e) => e.when));

      const up = await snapshot(t.client);
      expect([...up.keys()].sort()).toEqual([...head.keys()].sort());
      for (const [table, shot] of up)
        expect(shot.columns, `cột của ${table} sau tiến`).toEqual(
          head.get(table)!.columns,
        );
      // Tiến lại không được đụng dữ liệu đã sống sót qua lần lùi (bảng dựng lại thì rỗng hoặc chỉ có dòng backfill).
      for (const { table, columns } of comparable(down, up))
        expect(
          project(up.get(table)!.rows, columns),
          `${table} sau khi tiến lại`,
        ).toEqual(project(down.get(table)!.rows, columns));
    },
  );
});
