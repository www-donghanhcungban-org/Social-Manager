import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import * as schema from "../db/schema";
import type { Db } from "./members";

const MIN_SECRET_CHARS = 32;
const MIN_PASSWORD_CHARS = 12;
const SESSION_DAYS = 7;

export interface AuthOptions {
  db: Db;
  /** Khoá ký phiên/cookie; thiếu hoặc ngắn thì dừng, không có giá trị mặc định. */
  secret: string;
  baseURL: string;
}

/**
 * Đăng nhập email + mật khẩu của Better Auth trên Postgres (Drizzle). Quyền theo workspace nằm ở
 * `members.ts`, không ở đây: đăng nhập chỉ chứng minh "bạn là ai".
 */
export function createAuth({ db, secret, baseURL }: AuthOptions) {
  if (secret.length < MIN_SECRET_CHARS) {
    throw new Error(
      `Thiếu secret đăng nhập (BETTER_AUTH_SECRET, tối thiểu ${MIN_SECRET_CHARS} ký tự)`,
    );
  }
  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema }),
    secret,
    baseURL,
    emailAndPassword: { enabled: true, minPasswordLength: MIN_PASSWORD_CHARS },
    session: { expiresIn: SESSION_DAYS * 24 * 60 * 60 },
  });
}
