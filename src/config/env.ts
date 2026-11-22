import { z } from "zod";

import { isValidMasterKey } from "../security/secret-box";

/**
 * Cấu hình đọc từ biến môi trường, kiểm lúc khởi động. Thêm biến: thêm vào `schema`, vào
 * `.env.example` và (nếu là bí mật) vào `SECRET_KEYS` — test so khớp ba nơi này.
 * Không biến nào ở đây mang tiền tố công khai `NEXT_PUBLIC_`: mọi thứ này chỉ ở server.
 */
const KEY_BYTES = 32;

/** Rỗng hoặc chỉ khoảng trắng coi như thiếu. */
const text = () =>
  z.preprocess(
    (v) =>
      typeof v === "string" ? (v.trim() === "" ? undefined : v.trim()) : v,
    z.string(),
  );

const schema = z.object({
  DATABASE_URL: text().refine(
    (v) => URL.canParse(v) && /^postgres(ql)?:\/\//.test(v),
    "phải là URL postgres://",
  ),
  BETTER_AUTH_SECRET: text().pipe(z.string().min(32, "tối thiểu 32 ký tự")),
  BETTER_AUTH_URL: text().pipe(z.url()),
  /** Khoá chủ của kho khoá nhà cung cấp: base64 của đúng 32 byte. */
  APP_SECRET_KEY: text().refine(
    isValidMasterKey,
    `phải là base64 chuẩn của ${KEY_BYTES} byte`,
  ),
  NODE_ENV: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined),
    z.enum(["development", "test", "production"]).default("development"),
  ),
  /** Header do reverse proxy đặt chứa IP client (vd `x-real-ip`); bỏ trống = mặc định của thư viện. */
  CLIENT_IP_HEADER: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined),
    z
      .string()
      .regex(/^[A-Za-z0-9-]{1,64}$/, "tên header không hợp lệ")
      .optional(),
  ),
  /** Hạn mức đăng nhập/đăng ký mỗi IP mỗi phút. */
  AUTH_RATE_LIMIT_PER_MIN: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : undefined),
    z.number().int().min(1).max(10_000).default(10),
  ),
  /** `false` để tắt worker nền trong tiến trình này (chạy riêng hoặc khi debug). */
  RUN_WORKERS: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined),
    z.enum(["true", "false"]).default("true"),
  ),
  SOCIALAPI_BASE_URL: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined),
    // Chỉ https: khoá API không bao giờ được gửi qua kênh không mã hoá (BASE-SEC-004).
    z.url({ protocol: /^https$/ }).default("https://api.social-api.ai/v1"),
  ),
});

export type Env = z.infer<typeof schema>;
export const ENV_KEYS = Object.keys(schema.shape) as (keyof Env)[];

/** Biến bí mật: bị che khi in/dump. DATABASE_URL tính là bí mật vì chứa mật khẩu. */
export const SECRET_KEYS = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "APP_SECRET_KEY",
] as const satisfies readonly (keyof Env)[];

/** Chỉ mang TÊN biến sai, không mang giá trị: thông báo của nó an toàn để in/log. */
export class ConfigError extends Error {
  constructor(readonly keys: string[]) {
    super(
      `Cấu hình không hợp lệ hoặc thiếu: ${keys.join(", ")} (xem .env.example)`,
    );
    this.name = "ConfigError";
  }
}

export function loadEnv(env: Record<string, string | undefined>): Env {
  const parsed = schema.safeParse(env);
  if (parsed.success) return parsed.data;
  // Cố ý bỏ message/received của Zod: chúng có thể kèm giá trị bí mật.
  const keys = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))];
  throw new ConfigError(keys);
}

/** Dùng lúc khởi động tiến trình: sai thì in tên biến ra stderr và thoát mã 1. */
export function loadEnvOrExit(
  env: Record<string, string | undefined>,
  io: { exit: (code: number) => never; stderr: (text: string) => void } = {
    exit: (code) => process.exit(code),
    stderr: (text) => process.stderr.write(text),
  },
): Env {
  try {
    return loadEnv(env);
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    io.stderr(`${e.message}\n`);
    return io.exit(1);
  }
}

/** Nơi DUY NHẤT của mã ứng dụng đọc `process.env` (tests/config/hygiene.test.ts giữ luật này). */
export const processEnv = (): Record<string, string | undefined> => process.env;

/** Có kiểm cấu hình ngay khi tiến trình khởi động không: server Node thật, không phải lúc `next build`. */
export function shouldValidateAtStartup(
  env: Record<string, string | undefined> = process.env,
) {
  return (
    env.NEXT_RUNTIME === "nodejs" && env.NEXT_PHASE !== "phase-production-build"
  );
}

/** Bản in/dump an toàn của cấu hình. */
export function redactEnv(env: Env): Record<string, string> {
  const secrets = new Set<string>(SECRET_KEYS);
  return Object.fromEntries(
    Object.entries(env).map(([k, v]) => [
      k,
      secrets.has(k) ? "***" : String(v),
    ]),
  );
}
