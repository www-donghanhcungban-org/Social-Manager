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

/**
 * Từ dừng tiếng Việt (đã bỏ dấu) thường gặp trong câu hỏi tự nhiên: vô nghĩa khi tìm theo "bất kỳ từ nào" vì khớp hầu hết
 * văn bản. Chỉ dùng khi `dropStopwords`; tìm theo "mọi từ" của người dùng không bao giờ bỏ từ.
 */
export const QUESTION_STOPWORDS = new Set([
  "la",
  "gi",
  "cua",
  "va",
  "co",
  "khong",
  "nao",
  "the",
  "nay",
  "do",
  "cho",
  "voi",
  "duoc",
  "ve",
  "trong",
  "khi",
  "nhu",
  "hay",
  "nhung",
  "thi",
  "ma",
  "de",
  "da",
  "se",
  "dang",
  "bao",
  "nhieu",
  "o",
  "bi",
  "tu",
  "den",
  "mot",
  "cac",
  "nhung",
  "ai",
  "sao",
  "the",
  "nao",
  "toi",
  "minh",
  "ban",
  "hoi",
  "xin",
  "vay",
]);

/**
 * Tách truy vấn thành từ đã bỏ dấu (chữ và số Unicode); bỏ dấu câu; trần số từ để truy vấn không phình. `dropStopwords`
 * bỏ từ dừng nhưng nếu bỏ hết thì giữ nguyên (câu chỉ gồm từ dừng vẫn tìm được gì đó).
 */
export function queryTokens(
  query: string,
  max = 10,
  { dropStopwords = false }: { dropStopwords?: boolean } = {},
): string[] {
  const all = fold(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t !== "");
  const kept = dropStopwords
    ? all.filter((t) => !QUESTION_STOPWORDS.has(t))
    : all;
  return (kept.length > 0 ? kept : all).slice(0, max);
}
