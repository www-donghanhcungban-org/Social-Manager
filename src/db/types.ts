import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type * as schema from "./schema";

/** Kết nối CSDL dùng chung cho mọi dịch vụ (node-postgres hay PGlite đều khớp). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
