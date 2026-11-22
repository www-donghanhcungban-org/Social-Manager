// Chạy migration lúc triển khai (image production không có drizzle-kit, chỉ có drizzle-orm).
// Dùng: DATABASE_URL=... node scripts/migrate.mjs
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Thiếu biến DATABASE_URL");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  console.log("migration xong");
} catch (error) {
  // Không in chuỗi kết nối (có mật khẩu): chỉ tên lỗi và thông điệp của driver.
  console.error(
    "migration lỗi:",
    error instanceof Error ? error.message : "không rõ",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
