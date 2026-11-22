import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

/** Kết nối Postgres thật (production/dev). Pool chỉ nối khi có truy vấn đầu tiên. */
export function createDb(databaseUrl: string) {
  if (!databaseUrl) throw new Error("Thiếu biến môi trường DATABASE_URL");
  return drizzle(new Pool({ connectionString: databaseUrl }), { schema });
}
