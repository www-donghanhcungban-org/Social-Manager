import { describe, expect, it } from "vitest";

import {
  check,
  immutableViolations,
  lintNewMigration,
  lockAppendOnlyViolations,
  parseLock,
  sha256,
} from "../../scripts/check-migrations.mjs";

/**
 * DB-MIG-003 (migration đã áp bất biến), DB-MIG-008 và OPS-DEPLOY-003 (expand/contract). Bộ kiểm là
 * scripts/check-migrations.mjs; CI chạy nó với origin/main để bắt cả việc sửa khoá.
 */
describe("migration đã phát hành bất biến (DB-MIG-003)", () => {
  it("kho thật: băm mọi migration trong khoá khớp, migration mới qua lint", () => {
    expect(check()).toEqual([]);
  });

  it("sửa một byte của migration đã áp là đỏ", () => {
    const lock = parseLock(
      `${sha256("CREATE TABLE a (id int);")}  drizzle/0000_a.sql\n`,
    );
    const edited = new Map([
      ["drizzle/0000_a.sql", "CREATE TABLE a (id bigint);"],
    ]);
    expect(immutableViolations(lock, edited)).toEqual([
      "drizzle/0000_a.sql: migration đã áp bị sửa (băm không khớp khoá)",
    ]);
  });

  it("xoá hoặc đổi tên migration đã áp là đỏ", () => {
    const lock = parseLock(`${sha256("x")}  drizzle/0000_a.sql\n`);
    expect(immutableViolations(lock, new Map())).toHaveLength(1);
  });

  it("nguyên văn thì đạt, kể cả khi thêm tệp mới ngoài khoá", () => {
    const lock = parseLock(`${sha256("x")}  drizzle/0000_a.sql\n`);
    const files = new Map([
      ["drizzle/0000_a.sql", "x"],
      ["drizzle/0001_b.sql", "y"],
    ]);
    expect(immutableViolations(lock, files)).toEqual([]);
  });

  it("khoá chỉ được thêm dòng: sửa hay xoá dòng so với nhánh chính là đỏ", () => {
    const base = parseLock(`${sha256("x")}  drizzle/0000_a.sql\n`);
    const added = parseLock(
      `${sha256("x")}  drizzle/0000_a.sql\n${sha256("y")}  drizzle/0001_b.sql\n`,
    );
    const rewritten = parseLock(`${sha256("z")}  drizzle/0000_a.sql\n`);
    expect(lockAppendOnlyViolations(base, added)).toEqual([]);
    expect(lockAppendOnlyViolations(base, rewritten)).toHaveLength(1);
    expect(lockAppendOnlyViolations(base, new Map())).toHaveLength(1);
  });

  it("dòng khoá sai định dạng bị từ chối thay vì bỏ qua", () => {
    expect(() => parseLock("không-phải-băm  drizzle/0000_a.sql\n")).toThrow(
      /sai định dạng/,
    );
  });
});

describe("expand/contract (DB-MIG-008, OPS-DEPLOY-003)", () => {
  it.each([
    ["ALTER TABLE t DROP COLUMN c;", "DROP COLUMN"],
    ["drop table t;", "DROP TABLE"],
    ["ALTER TABLE t RENAME COLUMN a TO b;", "RENAME"],
    ["ALTER TABLE t RENAME TO u;", "RENAME"],
    ["ALTER TABLE t ALTER COLUMN c TYPE bigint;", "đổi kiểu cột tại chỗ"],
    [
      "ALTER TABLE t ALTER COLUMN c SET DATA TYPE text;",
      "đổi kiểu cột tại chỗ",
    ],
  ])("migration mới %s bị chặn", (sql, name) => {
    const bad = lintNewMigration("drizzle/0099_x.sql", sql);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toContain(name);
  });

  it("có dòng `-- contract: <phát-hành-trước>` thì cho qua", () => {
    expect(
      lintNewMigration(
        "drizzle/0099_x.sql",
        "-- contract: v1.0.0\nALTER TABLE t DROP COLUMN c;",
      ),
    ).toEqual([]);
  });

  it("`-- contract:` rỗng không đủ", () => {
    expect(
      lintNewMigration("drizzle/0099_x.sql", "-- contract:\nDROP TABLE t;"),
    ).toHaveLength(1);
  });

  it("chữ DROP trong chú thích không bị tính", () => {
    expect(
      lintNewMigration(
        "drizzle/0099_x.sql",
        "-- không DROP COLUMN ở đây\nSELECT 1;",
      ),
    ).toEqual([]);
  });

  it("thêm cột, bảng, chỉ mục (expand) đạt", () => {
    expect(
      lintNewMigration(
        "drizzle/0099_x.sql",
        "ALTER TABLE t ADD COLUMN c text;\nCREATE INDEX i ON t (c);\nCREATE TABLE u (id int);",
      ),
    ).toEqual([]);
  });

  it("tệp .down.sql là đường lùi nên được phép DROP", () => {
    expect(
      lintNewMigration("drizzle/0099_x.down.sql", "DROP TABLE t;"),
    ).toEqual([]);
  });
});
