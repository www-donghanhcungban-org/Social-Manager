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
  /** Dự án và liên kết (M06): mọi thành viên xem; admin/owner tạo, đổi, gắn. */
  "projects.read",
  "projects.write",
  /** Xoá dữ liệu theo yêu cầu (không đảo ngược): chỉ owner. Xuất dữ liệu: admin/owner. */
  "data.erase",
  "data.export",
  /** Quyết định số phận một hành động gửi `send_unknown` (đã gửi hay chưa): admin/owner. */
  "actions.resolve",
] as const;
export type Action = (typeof ACTIONS)[number];

const MEMBER: readonly Action[] = [
  "inbox.read",
  "inbox.reply",
  "posts.publish",
  "evidence.read",
  "projects.read",
];
const ADMIN: readonly Action[] = [
  ...MEMBER,
  "evidence.write",
  "projects.write",
  "data.export",
  "actions.resolve",
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
