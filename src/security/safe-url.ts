/**
 * Allowlist scheme cho URL lấy từ dữ liệu ngoài trước khi đưa vào `href`/`src` (FE-SEC-002).
 * Chỉ `http:`, `https:`, `mailto:`; mọi thứ khác (javascript:, data:, vbscript:, file:, blob:, URL tương đối,
 * URL kiểu `//host`) trả `null`. Trả về dạng ĐÃ chuẩn hoá của `URL` để không còn ký tự ngụy trang
 * (khoảng trắng đầu, xuống dòng trong scheme, hoa/thường).
 */
const ALLOWED = new Set(["http:", "https:", "mailto:"]);
const MAX_LENGTH = 2048;

export function safeUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  if (input.length === 0 || input.length > MAX_LENGTH) return null;
  let url: URL;
  try {
    // Không truyền `base`: URL tương đối bị từ chối (không có nguồn tin cậy để giải).
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (!ALLOWED.has(url.protocol)) return null;
  // Thông tin đăng nhập trong URL là mồi lừa đảo và có thể lộ bí mật.
  if (url.username !== "" || url.password !== "") return null;
  if (url.protocol !== "mailto:" && url.hostname === "") return null;
  return url.href;
}
