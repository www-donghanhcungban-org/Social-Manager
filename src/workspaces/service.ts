import { asc, count, eq } from "drizzle-orm";

import { ConflictError } from "../auth/errors";
import type { Db } from "../auth/members";
import { members, workspaces, type Role } from "../db/schema";
import { ValidationError } from "../providers/types";

export interface WorkspaceView {
  id: string;
  name: string;
  role: Role;
}

const MAX_NAME = 100;
/** Trần số workspace mỗi người tạo: chặn lạm dụng tạo hàng loạt. */
export const MAX_WORKSPACES_PER_USER = 20;

export function createWorkspaceService({ db }: { db: Db }) {
  return {
    /** Tạo workspace và đặt người tạo làm owner trong một giao dịch: không có workspace mồ côi. */
    async create(input: {
      actorId: string;
      name: string;
    }): Promise<WorkspaceView> {
      if (input.actorId.trim() === "")
        throw new ValidationError("Thiếu người dùng");
      const name = input.name.normalize("NFC").trim();
      if (name === "" || name.length > MAX_NAME)
        throw new ValidationError(`Tên phải dài 1-${MAX_NAME} ký tự`);
      return db.transaction(async (tx) => {
        const [{ n }] = await tx
          .select({ n: count() })
          .from(members)
          .where(eq(members.userId, input.actorId));
        if (n >= MAX_WORKSPACES_PER_USER)
          throw new ConflictError(
            "workspace_limit",
            `Mỗi người tối đa ${MAX_WORKSPACES_PER_USER} workspace`,
          );
        const [ws] = await tx.insert(workspaces).values({ name }).returning();
        await tx.insert(members).values({
          workspaceId: ws!.id,
          userId: input.actorId,
          role: "owner",
        });
        return { id: ws!.id, name: ws!.name, role: "owner" as const };
      });
    },

    async listForUser(userId: string): Promise<WorkspaceView[]> {
      return db
        .select({
          id: workspaces.id,
          name: workspaces.name,
          role: members.role,
        })
        .from(members)
        .innerJoin(workspaces, eq(members.workspaceId, workspaces.id))
        .where(eq(members.userId, userId))
        .orderBy(asc(workspaces.name), asc(workspaces.id));
    },
  };
}

export type WorkspaceService = ReturnType<typeof createWorkspaceService>;
