/**
 * Header bảo mật cho mọi phản hồi HTML (PRF-WEB-007) và chống cache chung cho route theo người dùng
 * (PRF-WEB-001). Thuần hàm để test không cần chạy server.
 */

const NONCE_OK = /^[A-Za-z0-9+/=_-]+$/;

export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function buildCsp({
  nonce,
  dev,
}: {
  nonce: string;
  dev: boolean;
}): string {
  // Nonce nằm trong header: ký tự lạ có thể chèn thêm chỉ thị, nên chặn từ đầu.
  if (!NONCE_OK.test(nonce)) throw new Error("nonce không hợp lệ");
  return [
    "default-src 'self'",
    // strict-dynamic: script có nonce được tải thêm script khác; nguồn/`unsafe-inline` bị bỏ qua.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Next/Tailwind chèn style nội tuyến; rủi ro của style thấp hơn script nên chấp nhận có điều kiện.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");
}

export function securityHeaders(opts: {
  nonce: string;
  dev: boolean;
}): Record<string, string> {
  return {
    "Content-Security-Policy": buildCsp(opts),
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}

const PRIVATE_PREFIXES = ["/app", "/login", "/api"];

/** Route có dữ liệu theo người dùng: `private, no-store`. Khớp theo đoạn đường dẫn, không theo tiền tố chuỗi. */
export function cacheControlFor(pathname: string): string | undefined {
  const isPrivate = PRIVATE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  return isPrivate ? "private, no-store" : undefined;
}
