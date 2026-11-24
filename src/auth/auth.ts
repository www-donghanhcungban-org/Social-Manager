import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import * as schema from "../db/schema";
import { defaultLogger } from "../log/process";
import { logSecurityEvent } from "../log/security-events";
import type { Db } from "./members";
import { hashPassword, verifyPassword } from "./password";
import { createLoginThrottle } from "./throttle";

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

/** IP/user-agent/request id từ request gốc; IP theo header proxy tin cậy nếu cấu hình. Không bao giờ ném lỗi. */
function requestInfo(req: Request | undefined, ipHeader?: string) {
  const h = req?.headers;
  const first = h
    ?.get(ipHeader ?? "x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  return {
    sourceIp: first === undefined || first === "" ? null : first,
    userAgent: h?.get("user-agent") ?? null,
    requestId: h?.get("x-request-id") ?? crypto.randomUUID(),
  };
}

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
  const throttle = createLoginThrottle({ db, secret });
  const emailOf = (body: unknown): string | undefined => {
    const e = (body as { email?: unknown } | null | undefined)?.email;
    return typeof e === "string" && e.length > 0 && e.length <= 320
      ? e
      : undefined;
  };
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
      // Argon2id thay scrypt mặc định (BE-AUTH-001).
      password: { hash: hashPassword, verify: verifyPassword },
    },
    session: { expiresIn: SESSION_DAYS * 24 * 60 * 60 },
    hooks: {
      // Khoá theo tài khoản (BE-AUTH-003), ngoài giới hạn theo IP. Cùng một phản hồi cho email có
      // đăng ký lẫn chưa đăng ký. Giữ chỗ (tính là một lần sai) TRƯỚC khi kiểm mật khẩu, nguyên tử với
      // việc kiểm khoá: request song song từ nhiều IP không vượt được ngưỡng (T-585). Đăng nhập đúng xoá
      // bộ đếm ở `after`; lỗi khác (thân sai…) vẫn tính là một lần thử — nghiêng về an toàn.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email") return;
        const email = emailOf(ctx.body);
        if (email && !(await throttle.tryAttempt(email))) {
          logSecurityEvent(defaultLogger(), {
            event: "auth.login_locked",
            outcome: "denied",
            ...requestInfo(ctx.request, clientIpHeader),
          });
          throw new APIError("TOO_MANY_REQUESTS", {
            code: "TOO_MANY_ATTEMPTS",
            message: "Thử đăng nhập quá nhiều lần, hãy thử lại sau ít phút",
          });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email") return;
        const email = emailOf(ctx.body);
        if (!email) return;
        const returned = ctx.context.returned;
        if (isAPIError(returned)) {
          const code = (returned.body as { code?: string } | undefined)?.code;
          if (code === "INVALID_EMAIL_OR_PASSWORD") {
            // Lần sai đã được đếm ở `before` (giữ chỗ); ở đây chỉ ghi sự kiện.
            logSecurityEvent(defaultLogger(), {
              event: "auth.login_failed",
              outcome: "denied",
              ...requestInfo(ctx.request, clientIpHeader),
            });
          }
        } else if (returned) {
          await throttle.recordSuccess(email);
          const userId = (returned as { user?: { id?: unknown } }).user?.id;
          logSecurityEvent(defaultLogger(), {
            event: "auth.login_succeeded",
            outcome: "success",
            actor: typeof userId === "string" ? userId : undefined,
            ...requestInfo(ctx.request, clientIpHeader),
          });
        }
      }),
    },
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
    advanced: {
      ...(clientIpHeader && {
        ipAddress: { ipAddressHeaders: [clientIpHeader] },
      }),
      // Trên https dùng tiền tố `__Host-` (BE-AUTH-004): trình duyệt chỉ nhận khi Secure, Path=/ và không
      // có Domain, nên subdomain khác không ghi đè được cookie phiên. Better Auth tự gắn `__Secure-`
      // phía trước khi bật secure, tạo tên `__Secure-__Host-…` vô nghĩa; vì vậy tắt cờ đó và tự đặt
      // `secure: true` cùng tiền tố. Trên http cục bộ giữ tên mặc định (`__Host-` đòi Secure nên không dùng được).
      ...(baseURL.startsWith("https://") && {
        useSecureCookies: false,
        cookiePrefix: "__Host-sm",
        defaultCookieAttributes: { secure: true, path: "/" },
      }),
    },
  });
}
