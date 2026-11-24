import { timingSafeEqual } from "node:crypto";

/**
 * `/api/metrics` chỉ mở khi đặt `METRICS_TOKEN` (≥ 24 ký tự) và request gửi đúng `Authorization: Bearer <token>`.
 * Chưa đặt → `disabled` (route trả 404, như không tồn tại). Sai → `denied`. So sánh thời gian hằng.
 */
export type MetricsAccess = "ok" | "denied" | "disabled";

export const MIN_METRICS_TOKEN = 24;

export function checkMetricsAccess(
  configured: string | undefined,
  authorization: string | null,
): MetricsAccess {
  if (!configured || configured.length < MIN_METRICS_TOKEN) return "disabled";
  const m = /^Bearer (.+)$/.exec(authorization ?? "");
  if (!m) return "denied";
  const a = Buffer.from(m[1]!);
  const b = Buffer.from(configured);
  return a.length === b.length && timingSafeEqual(a, b) ? "ok" : "denied";
}
