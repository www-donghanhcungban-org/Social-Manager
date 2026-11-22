import type { Role } from "../db/schema";

export const ACTIONS = [
  "inbox.read",
  "inbox.reply",
  "posts.publish",
  "connections.manage",
  "members.invite",
  "members.remove",
  "members.changeRole",
  "workspace.delete",
  /** Đổi cấu hình workspace (thời hạn lưu dữ liệu, D-010): chỉ owner. */
  "workspace.settings",
  /** Kho bằng chứng (ADR-0004): mọi thành viên đọc; admin/owner nhập nội dung. */
  "evidence.read",
  "evidence.write",
] as const;
export type Action = (typeof ACTIONS)[number];

const MEMBER: readonly Action[] = [
  "inbox.read",
  "inbox.reply",
  "posts.publish",
  "evidence.read",
];
const ADMIN: readonly Action[] = [
  ...MEMBER,
  "evidence.write",
  "connections.manage",
  "members.invite",
  "members.remove",
];

const BY_ROLE: Record<Role, readonly Action[]> = {
  member: MEMBER,
  admin: ADMIN,
  owner: ACTIONS,
};

/** Quyền theo vai trò. `null` = không phải thành viên workspace → không làm được gì. */
export function can(role: Role | null, action: Action): boolean {
  return role !== null && BY_ROLE[role].includes(action);
}
