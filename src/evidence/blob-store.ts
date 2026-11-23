import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Khoá lưu là sha256 hex thường 64 ký tự: chặn `..`, dấu `/` và mọi đường dẫn tuỳ ý trước khi chạm đĩa. */
const SHA256 = /^[0-9a-f]{64}$/;

function checkKey(sha256: string) {
  if (!SHA256.test(sha256)) throw new Error("Khoá blob không hợp lệ");
}

/**
 * Cổng lưu nội dung theo địa chỉ nội dung (ADR-0004). Cài đặt thật là thư mục volume; bản bộ nhớ cho test.
 * `put` lũy đẳng (cùng khoá = cùng nội dung); không kiểm quyền — quyền kiểm ở dịch vụ bằng dòng DB theo workspace.
 */
export interface BlobStore {
  put(sha256: string, bytes: Uint8Array): Promise<void>;
  get(sha256: string): Promise<Uint8Array | null>;
  delete(sha256: string): Promise<void>;
}

export function createMemoryBlobStore(): BlobStore & {
  readonly size: number;
  /** Chỉ cho test: ghi đè nội dung sau lưng dịch vụ để mô phỏng hỏng đĩa. */
  corrupt(sha256: string, bytes: Uint8Array): void;
} {
  const map = new Map<string, Uint8Array>();
  return {
    get size() {
      return map.size;
    },
    async put(sha256, bytes) {
      checkKey(sha256);
      map.set(sha256, new Uint8Array(bytes));
    },
    async get(sha256) {
      checkKey(sha256);
      const v = map.get(sha256);
      return v ? new Uint8Array(v) : null;
    },
    async delete(sha256) {
      checkKey(sha256);
      map.delete(sha256);
    },
    corrupt(sha256, bytes) {
      map.set(sha256, new Uint8Array(bytes));
    },
  };
}

/**
 * Thư mục theo `sha256`: `<dir>/<2 ký tự đầu>/<sha256>`. Ghi qua tệp tạm rồi đổi tên nên người đọc không bao giờ thấy
 * tệp ghi dở; khoá đã kiểm định dạng nên không thoát khỏi `dir`.
 */
export function createFsBlobStore(dir: string): BlobStore {
  const pathOf = (sha256: string) => join(dir, sha256.slice(0, 2), sha256);
  return {
    async put(sha256, bytes) {
      checkKey(sha256);
      const target = pathOf(sha256);
      await mkdir(dirname(target), { recursive: true });
      const tmp = `${target}.${randomUUID()}.tmp`;
      try {
        await writeFile(tmp, bytes, { mode: 0o600 });
        await rename(tmp, target);
      } catch (e) {
        await rm(tmp, { force: true });
        throw e;
      }
    },
    async get(sha256) {
      checkKey(sha256);
      try {
        return new Uint8Array(await readFile(pathOf(sha256)));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    async delete(sha256) {
      checkKey(sha256);
      await rm(pathOf(sha256), { force: true });
    },
  };
}
