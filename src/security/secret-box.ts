import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Mã hoá khoá nhà cung cấp trước khi lưu DB: AES-256-GCM (mã hoá có xác thực, node:crypto).
 * Định dạng: `v1:` + base64url(IV 12 byte ‖ bản mã ‖ thẻ xác thực 16 byte). Tiền tố phiên bản chừa
 * chỗ cho xoay khoá/đổi thuật toán sau này mà không làm hỏng dữ liệu cũ.
 */
const VERSION = "v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface SecretBox {
  encrypt(plain: string): string;
  /** Ném lỗi (không bao giờ trả rác) khi token sai định dạng, bị sửa, hoặc sai khoá. */
  decrypt(token: string): string;
}

const DECRYPT_ERROR =
  "Không giải mã được dữ liệu (sai khoá, bị sửa hoặc sai định dạng)";

/**
 * Bộ giải base64 của Node dễ dãi (bỏ qua ký tự lạ, thiếu đệm), nên mật khẩu thường cũng "giải" ra 32
 * byte. Chỉ nhận dạng chuẩn: giải rồi mã lại phải ra đúng chuỗi ban đầu.
 */
function decodeMasterKey(value: string): Buffer | undefined {
  const key = Buffer.from(value, "base64");
  return key.length === KEY_BYTES && key.toString("base64") === value
    ? key
    : undefined;
}

export const isValidMasterKey = (value: string) =>
  decodeMasterKey(value) !== undefined;

export function createSecretBox(masterKeyBase64: string): SecretBox {
  const key = decodeMasterKey(masterKeyBase64);
  // Thông báo cố ý không chứa giá trị khoá.
  if (key === undefined) {
    throw new Error(`Khoá chủ phải là base64 chuẩn của đúng ${KEY_BYTES} byte`);
  }

  return {
    encrypt(plain) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([
        cipher.update(plain, "utf8"),
        cipher.final(),
      ]);
      return (
        VERSION +
        Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url")
      );
    },

    decrypt(token) {
      if (!token.startsWith(VERSION)) throw new Error(DECRYPT_ERROR);
      const raw = Buffer.from(token.slice(VERSION.length), "base64url");
      if (raw.length < IV_BYTES + TAG_BYTES) throw new Error(DECRYPT_ERROR);
      try {
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          raw.subarray(0, IV_BYTES),
        );
        decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
        const body = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);
        return Buffer.concat([
          decipher.update(body),
          decipher.final(),
        ]).toString("utf8");
      } catch {
        throw new Error(DECRYPT_ERROR);
      }
    },
  };
}

/** Khoá chủ lấy từ biến môi trường; thiếu thì dừng, không có khoá mặc định. */
export function secretBoxFromEnv(
  env: Record<string, string | undefined>,
): SecretBox {
  const key = env.APP_SECRET_KEY;
  if (!key)
    throw new Error(
      "Thiếu biến môi trường APP_SECRET_KEY (base64 của 32 byte ngẫu nhiên)",
    );
  return createSecretBox(key);
}
