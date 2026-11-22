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
  /**
   * Header mà reverse proxy của bạn ĐẶT (ghi đè giá trị client gửi) chứa IP client, ví dụ `x-real-ip`
   * hay `cf-connecting-ip`. Không đặt: dùng mặc định của Better Auth (`x-forwarded-for`), chỉ an toàn
   * khi sau proxy tin cậy; để lộ thẳng ra internet thì kẻ tấn công đổi header để né giới hạn.
   */
  clientIpHeader?: string;
  /** Hạn mức đăng nhập/đăng ký mỗi IP mỗi phút (chống dò mật khẩu). */
  rateLimitPerMinute?: number;
}

const DEFAULT_AUTH_RATE_PER_MIN = 10;

/**
 * Đăng nhập email + mật khẩu của Better Auth trên Postgres (Drizzle). Quyền theo workspace nằm ở
 * `members.ts`, không ở đây: đăng nhập chỉ chứng minh "bạn là ai".
 */
export function createAuth({
  db,
  secret,
  baseURL,
  clientIpHeader,
  rateLimitPerMinute = DEFAULT_AUTH_RATE_PER_MIN,
}: AuthOptions) {
  if (secret.length < MIN_SECRET_CHARS) {
    throw new Error(
      `Thiếu secret đăng nhập (BETTER_AUTH_SECRET, tối thiểu ${MIN_SECRET_CHARS} ký tự)`,
    );
  }
  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema }),
    secret,
    baseURL,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_CHARS,
      // Không tự đăng nhập sau đăng ký: nhờ vậy đăng ký email mới và email đã có cho cùng một phản hồi,
      // kẻ tấn công không dò được email nào đã đăng ký (review 🟠 6, D-005).
      autoSignIn: false,
    },
    session: { expiresIn: SESSION_DAYS * 24 * 60 * 60 },
    // DEBT: bộ đếm lưu trong bộ nhớ tiến trình | trần: nhiều bản sao server thì hạn mức nhân lên theo số bản |
    // xem lại khi: chạy nhiều instance (chuyển storage sang "database")
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      storage: "memory",
      customRules: {
        "/sign-in/email": { window: 60, max: rateLimitPerMinute },
        "/sign-up/email": { window: 60, max: rateLimitPerMinute },
      },
    },
    ...(clientIpHeader && {
      advanced: { ipAddress: { ipAddressHeaders: [clientIpHeader] } },
    }),
  });
}
