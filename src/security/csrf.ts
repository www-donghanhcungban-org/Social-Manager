/**
 * Lớp chống CSRF cho request đổi trạng thái (SEC-WEB-007): từ chối cross-site theo
 * `Sec-Fetch-Site`, nếu thiếu thì so `Origin` với `Host`. Cookie phiên đã SameSite=Lax (Better Auth).
 */

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function isCrossSiteMutation(method: string, headers: Headers): boolean {
  if (SAFE.has(method.toUpperCase())) return false;

  const site = headers.get("sec-fetch-site");
  if (site !== null) return site !== "same-origin" && site !== "none";

  const origin = headers.get("origin");
  if (origin !== null) {
    const host = headers.get("host");
    try {
      return host === null || new URL(origin).host !== host;
    } catch {
      return true; // "null", rỗng, không phải URL
    }
  }

  // Trình duyệt luôn gửi Origin/Sec-Fetch-Site cho POST; thiếu cả hai mà có cookie là khả nghi.
  return headers.has("cookie");
}
