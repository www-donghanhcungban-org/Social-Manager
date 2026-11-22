import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import * as schema from "@/src/db/schema";

export const MIGRATIONS = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

/** DB Postgres trong tiến trình, đã chạy migration thật (cùng thư mục `drizzle/` mà production dùng). */
export async function createTestDb(queries?: string[]) {
  const client = new PGlite();
  const db = drizzle(client, {
    schema,
    logger: queries
      ? { logQuery: (q: string) => void queries.push(q) }
      : undefined,
  });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { client, db };
}

export const readDownSql = (name: string) =>
  readFileSync(`${MIGRATIONS}/${name}.down.sql`, "utf8");

export async function tableNames(client: PGlite): Promise<string[]> {
  const r = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_name not like '\\_\\_%' order by 1`,
  );
  return r.rows.map((x) => x.table_name);
}
