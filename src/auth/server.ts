import { createDb } from "../db/client";
import { createAuth } from "./auth";
import type { Db } from "./members";

type Env = Record<string, string | undefined>;

/** Dựng auth từ biến môi trường; thiếu biến nào thì dừng và nêu tên biến. */
export function createAuthFromEnv(env: Env) {
  const baseURL = env.BETTER_AUTH_URL;
  if (!baseURL) throw new Error("Thiếu biến môi trường BETTER_AUTH_URL");
  return createAuth({
    db: createDb(env.DATABASE_URL ?? "") as unknown as Db,
    secret: env.BETTER_AUTH_SECRET ?? "",
    baseURL,
  });
}

let instance: ReturnType<typeof createAuthFromEnv> | undefined;

/** Dùng chung một instance trong tiến trình; tạo lúc có request đầu tiên, không phải lúc import. */
export function getAuth() {
  instance ??= createAuthFromEnv(process.env);
  return instance;
}
