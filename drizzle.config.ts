import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // Chỉ `drizzle-kit migrate`/`studio` cần URL; `generate` không đụng DB. Đọc thẳng biến môi trường
  // (file công cụ, không thuộc mã chạy của app nên không qua src/config/env.ts).
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
