import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb } from "./helpers";

/** Kiểm schema sau khi chạy đủ migration, bằng catalog của Postgres (DB-MODEL-004). */
let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.client.close();
});

const rows = async <T>(sql: string) => (await t.client.query<T>(sql)).rows;

describe("khoá ngoại (DB-MODEL-004)", () => {
  it("mọi khoá ngoại ghi ON DELETE tường minh (không để NO ACTION mặc định)", async () => {
    const noAction = await rows<{ name: string }>(`
      select conrelid::regclass || '.' || conname as name
      from pg_constraint
      where contype = 'f' and confdeltype = 'a'
        and connamespace = 'public'::regnamespace
      order by 1`);
    expect(noAction.map((r) => r.name)).toEqual([]);
  });

  it("mọi khoá ngoại có index mà cột FK đứng đầu (xoá theo tầng/join không quét cả bảng)", async () => {
    const missing = await rows<{ name: string }>(`
      select c.conrelid::regclass || '(' || string_agg(a.attname, ',' order by k.ord) || ')' as name
      from pg_constraint c
      cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid
            and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey
        )
      group by c.conrelid, c.conname
      order by 1`);
    expect(missing.map((r) => r.name)).toEqual([]);
  });
});
