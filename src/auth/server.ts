import { loadEnv, processEnv } from "../config/env";
import { createDb } from "../db/client";
import { createAuth } from "./auth";
import type { Db } from "./members";

/** Dựng auth từ biến môi trường đã kiểm (`loadEnv`): thiếu/sai biến nào thì dừng và nêu tên biến. */
export function createAuthFromEnv(env: Record<string, string | undefined>) {
  const cfg = loadEnv(env);
  return createAuth({
    db: createDb(cfg.DATABASE_URL) as unknown as Db,
    secret: cfg.BETTER_AUTH_SECRET,
    baseURL: cfg.BETTER_AUTH_URL,
  });
}

let instance: ReturnType<typeof createAuthFromEnv> | undefined;

/** Dùng chung một instance trong tiến trình; tạo lúc có request đầu tiên, không phải lúc import. */
export function getAuth() {
  instance ??= createAuthFromEnv(processEnv());
  return instance;
}
