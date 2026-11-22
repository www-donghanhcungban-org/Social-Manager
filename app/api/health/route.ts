import { sql } from "drizzle-orm";

import { checkHealth } from "@/src/http/health";
import { getContainer } from "@/src/server/runtime";

const TIMEOUT_MS = 2000;

/** Công khai, chỉ đọc, không mang dữ liệu người dùng: dùng cho healthcheck của Docker và giám sát. */
export async function GET() {
  const { status, body } = await checkHealth(async () => {
    await getContainer().db.execute(sql`select 1`);
  }, TIMEOUT_MS);
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
