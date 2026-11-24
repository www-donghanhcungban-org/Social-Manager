import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "../db/schema";
import { auditEvents, type AuditOutcome } from "../db/schema";

// Cùng kiểu với `Db` của auth/members; khai báo lại để audit không phụ thuộc ngược vào auth (tránh vòng import).
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * Ghi audit trail (SEC-LOG-007, CMP-AUDIT-002). Bảng chỉ ghi thêm (trigger CSDL chặn UPDATE/DELETE/TRUNCATE).
 * Ghi CÙNG giao dịch với thay đổi khi có thể (truyền `tx`): thay đổi thành công thì dấu vết có, thay đổi lùi thì dấu vết lùi.
 * Không nhận nội dung người dùng: chỉ loại + id đối tượng và mã lý do ngắn.
 */
export interface AuditContext {
  sourceIp?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/** Tên sự kiện đã đăng ký: `docs/security/security-events.md` đối chiếu với danh sách này (có test). */
export const AUDIT_ACTIONS = [
  "workspace.retention_changed",
  "workspace.ai_cloud_changed",
  "workspace.outbound_changed",
  "member.added",
  "member.role_changed",
  "member.removed",
  "connection.created",
  "connection.removed",
  "connection.webhook_secret_changed",
  "account.added",
  "account.removed",
  "data.erased",
  "data.exported",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditInput {
  workspaceId: string;
  actorId: string;
  action: AuditAction;
  targetType: string;
  targetId?: string | null;
  outcome?: AuditOutcome;
  /** Mã/lý do ngắn, không chứa dữ liệu cá nhân (vd `days=30`). */
  reason?: string | null;
}

type Provider = () => Promise<AuditContext | undefined>;
let provider: Provider = async () => undefined;

/** Tầng server đăng ký cách lấy IP/user-agent/request id của request hiện tại (dịch vụ không biết framework). */
export function setAuditContextProvider(p: Provider) {
  provider = p;
}

const clip = (v: string | null | undefined, n: number) =>
  v == null || v === "" ? null : v.slice(0, n);

export async function recordAudit(db: Db, input: AuditInput): Promise<void> {
  let ctx: AuditContext | undefined;
  try {
    ctx = await provider();
  } catch {
    ctx = undefined;
  }
  await db.insert(auditEvents).values({
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: clip(input.targetId, 128),
    outcome: input.outcome ?? "success",
    reason: clip(input.reason, 200),
    sourceIp: clip(ctx?.sourceIp, 64),
    userAgent: clip(ctx?.userAgent, 256),
    requestId: clip(ctx?.requestId, 128),
  });
}
