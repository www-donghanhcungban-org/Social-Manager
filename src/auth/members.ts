import { and, count, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "../db/schema";
import { members, workspaces, type Role } from "../db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { can } from "./permissions";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export async function getRole(
  db: Db,
  workspaceId: string,
  userId: string,
): Promise<Role | null> {
  const [row] = await db
    .select({ role: members.role })
    .from(members)
    .where(
      and(eq(members.workspaceId, workspaceId), eq(members.userId, userId)),
    );
  return row?.role ?? null;
}

/**
 * Mọi thay đổi thành viên chạy tuần tự theo workspace (khoá dòng workspace trong transaction), để hai
 * thao tác đồng thời không cùng vượt kiểm tra "còn owner khác" rồi để workspace không còn owner.
 */
function withWorkspaceLock<T>(
  db: Db,
  workspaceId: string,
  fn: (tx: Db) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      // NO KEY UPDATE đủ để tuần tự hoá và không xung đột với khoá khoá ngoại (FOR KEY SHARE).
      .for("no key update");
    return fn(tx as unknown as Db);
  });
}

async function ownerCount(db: Db, workspaceId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(members)
    .where(
      and(eq(members.workspaceId, workspaceId), eq(members.role, "owner")),
    );
  return row?.n ?? 0;
}

export function addMember(
  db: Db,
  input: { actorId: string; workspaceId: string; userId: string; role: Role },
) {
  return withWorkspaceLock(db, input.workspaceId, async (tx) => {
    const actor = await getRole(tx, input.workspaceId, input.actorId);
    if (!can(actor, "members.invite")) throw new ForbiddenError();
    // Admin chỉ thêm được member: không tự nâng quyền cho người khác ngang hoặc hơn mình.
    if (actor === "admin" && input.role !== "member")
      throw new ForbiddenError();
    if ((await getRole(tx, input.workspaceId, input.userId)) !== null) {
      throw new ConflictError("already_member", "Người này đã là thành viên");
    }
    await tx.insert(members).values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      role: input.role,
    });
  });
}

export function changeRole(
  db: Db,
  input: {
    actorId: string;
    workspaceId: string;
    targetUserId: string;
    newRole: Role;
  },
) {
  return withWorkspaceLock(db, input.workspaceId, async (tx) => {
    const actor = await getRole(tx, input.workspaceId, input.actorId);
    if (!can(actor, "members.changeRole")) throw new ForbiddenError();
    const target = await getRole(tx, input.workspaceId, input.targetUserId);
    if (target === null)
      throw new NotFoundError("Người này không phải thành viên");
    if (target === input.newRole) return;
    if (target === "owner" && (await ownerCount(tx, input.workspaceId)) <= 1) {
      throw new ConflictError(
        "last_owner",
        "Workspace phải còn ít nhất một owner",
      );
    }
    await tx
      .update(members)
      .set({ role: input.newRole })
      .where(
        and(
          eq(members.workspaceId, input.workspaceId),
          eq(members.userId, input.targetUserId),
        ),
      );
  });
}

export function removeMember(
  db: Db,
  input: { actorId: string; workspaceId: string; targetUserId: string },
) {
  return withWorkspaceLock(db, input.workspaceId, async (tx) => {
    const actor = await getRole(tx, input.workspaceId, input.actorId);
    // Người ngoài bị từ chối trước khi lộ ai là thành viên.
    if (actor === null) throw new ForbiddenError();
    const isSelf = input.actorId === input.targetUserId;
    // Kiểm quyền TRƯỚC khi tra mục tiêu: người không đủ quyền không phân biệt được ai là thành viên.
    if (!isSelf && !can(actor, "members.remove")) throw new ForbiddenError();
    const target = await getRole(tx, input.workspaceId, input.targetUserId);
    if (target === null)
      throw new NotFoundError("Người này không phải thành viên");
    // Ai cũng được tự rời. Xoá người khác: admin chỉ xoá được member.
    if (!isSelf && actor === "admin" && target !== "member")
      throw new ForbiddenError();
    if (target === "owner" && (await ownerCount(tx, input.workspaceId)) <= 1) {
      throw new ConflictError(
        "last_owner",
        "Workspace phải còn ít nhất một owner",
      );
    }
    await tx
      .delete(members)
      .where(
        and(
          eq(members.workspaceId, input.workspaceId),
          eq(members.userId, input.targetUserId),
        ),
      );
  });
}
