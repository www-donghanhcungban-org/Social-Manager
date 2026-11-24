import { sql } from "drizzle-orm";

import { timed } from "@/src/observability/instrument";
import { checkHealth } from "@/src/http/health";
import { getContainer } from "@/src/server/runtime";
import { isDraining } from "@/src/server/shutdown";

const TIMEOUT_MS = 2000;

/** Công khai, chỉ đọc, không mang dữ liệu người dùng: dùng cho healthcheck của Docker và giám sát. */
export const GET = timed("GET", "/api/health", async () => {
  const { status, body } = await checkHealth(
    async () => {
      await getContainer().db.execute(sql`select 1`);
    },
    TIMEOUT_MS,
    { draining: isDraining() },
  );
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
});
