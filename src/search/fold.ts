/**
 * Bỏ dấu tiếng Việt cho tìm kiếm không dấu (H8). Postgres `unaccent` mặc định không phủ `đ` và không có bộ tách từ tiếng
 * Việt, nên dự án tự bỏ dấu ở tầng ứng dụng rồi dùng cấu hình `simple`.
 *
 * Quy ước: MỖI KÝ TỰ (code point của văn bản đã chuẩn hoá NFC) cho đúng MỘT ký tự, nên vị trí trong văn bản đã bỏ dấu
 * trùng vị trí trong nguyên văn — dùng để cắt đoạn trích từ nguyên văn.
 */
export function foldChar(ch: string): string {
  if (ch === "đ") return "d";
  if (ch === "Đ") return "d";
  const base = Array.from(ch.normalize("NFD").replace(/\p{M}/gu, ""))[0] ?? ch;
  const lower = Array.from(base.toLowerCase())[0];
  return lower ?? base;
}

/** Văn bản (NFC) → ký tự thường không dấu, giữ nguyên độ dài theo ký tự. */
export function fold(text: string): string {
  return Array.from(text.normalize("NFC"), foldChar).join("");
}

/** Tách truy vấn thành từ đã bỏ dấu (chữ và số Unicode); bỏ dấu câu; trần số từ để truy vấn không phình. */
export function queryTokens(query: string, max = 10): string[] {
  return fold(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t !== "")
    .slice(0, max);
}
