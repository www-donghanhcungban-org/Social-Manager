import type { Logger } from "./logger";

/**
 * Sự kiện bảo mật có trường chuẩn (SEC-LOG-001/002, OWASP Logging CS). Mỗi sự kiện là MỘT dòng log có cấu trúc:
 * `timestamp` UTC ISO-8601 do logger đặt, rồi `event`, `actor`, `target_type`/`target_id`, `outcome`, `source_ip`,
 * `user_agent`, `request_id`. Không ghi nội dung người dùng, mật khẩu, token, email thô (dùng `actor` là id hoặc băm).
 * Hành động quản trị/đổi cấu hình/xuất xoá dữ liệu nằm ở audit trail trong CSDL (`src/audit`), không trùng ở đây.
 * Danh sách ↔ `docs/security/security-events.md` có test đối chiếu.
 */
export const SECURITY_EVENTS = [
  "auth.login_succeeded",
  "auth.login_failed",
  "auth.login_locked",
  "authz.denied",
  "input.invalid",
  "webhook.signature_invalid",
  "ai.blocked",
  "ai.budget_exceeded",
] as const;
export type SecurityEvent = (typeof SECURITY_EVENTS)[number];

export const SECURITY_OUTCOMES = ["success", "denied", "error"] as const;
export type SecurityOutcome = (typeof SECURITY_OUTCOMES)[number];

export interface SecurityEventInput {
  event: SecurityEvent;
  outcome: SecurityOutcome;
  /** user id hoặc `anonymous`; không email/tên thật. */
  actor?: string;
  targetType?: string;
  targetId?: string;
  sourceIp?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

const UA_MAX = 256;

/** Dòng log chuẩn: mọi trường luôn có mặt (null khi chưa biết) để máy kiểm đủ trường. */
export function securityEventFields(e: SecurityEventInput) {
  return {
    event: e.event,
    actor: e.actor ?? "anonymous",
    target_type: e.targetType ?? null,
    target_id: e.targetId ?? null,
    outcome: e.outcome,
    source_ip: e.sourceIp ?? null,
    user_agent: e.userAgent == null ? null : e.userAgent.slice(0, UA_MAX),
    request_id: e.requestId ?? null,
    security_event: true,
  };
}

export function logSecurityEvent(log: Logger, e: SecurityEventInput): void {
  const level = e.outcome === "success" ? "info" : "warn";
  log[level](`security event: ${e.event}`, securityEventFields(e));
}
