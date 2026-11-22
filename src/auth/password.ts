import { argon2Verify, argon2id } from "hash-wasm";

/**
 * Băm mật khẩu Argon2id theo khuyến nghị OWASP (m=19456 KiB, t=2, p=1), lưu dạng chuỗi PHC để
 * nâng tham số dần (BE-AUTH-001). Chuẩn hoá NFC trước khi băm: cùng một mật khẩu gõ ở máy khác
 * (NFD) vẫn khớp.
 */
const PARAMS = { memorySize: 19456, iterations: 2, parallelism: 1 } as const;
const HASH_BYTES = 32;
const SALT_BYTES = 16;

export async function hashPassword(password: string): Promise<string> {
  return argon2id({
    password: password.normalize("NFC"),
    salt: crypto.getRandomValues(new Uint8Array(SALT_BYTES)),
    hashLength: HASH_BYTES,
    outputType: "encoded",
    ...PARAMS,
  });
}

export async function verifyPassword({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  try {
    return await argon2Verify({ password: password.normalize("NFC"), hash });
  } catch {
    return false; // hash hỏng/không phải PHC: coi như sai, không lộ chi tiết
  }
}
