import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import * as schema from "./schema";

/** Timeout tường minh cho mọi lời gọi CSDL (BASE-ERR-004): không bao giờ chờ vô hạn. */
export const DB_TIMEOUTS = {
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  statement_timeout: 30_000,
  idle_in_transaction_session_timeout: 60_000,
  query_timeout: 35_000,
} as const satisfies PoolConfig;

export function poolConfig(databaseUrl: string): PoolConfig {
  if (!databaseUrl) throw new Error("Thiếu biến môi trường DATABASE_URL");
  return { connectionString: databaseUrl, ...DB_TIMEOUTS };
}

/** Kết nối Postgres thật (production/dev). Pool chỉ nối khi có truy vấn đầu tiên. */
export function createDb(databaseUrl: string) {
  return drizzle(new Pool(poolConfig(databaseUrl)), { schema });
}
