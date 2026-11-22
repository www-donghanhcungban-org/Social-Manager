import { and, asc, eq } from "drizzle-orm";

import { requireAction, UUID } from "../auth/access";
import { ConflictError, NotFoundError } from "../auth/errors";
import type { Db } from "../auth/members";
import {
  conversations,
  evidenceItems,
  nameKeyOf,
  projectAliases,
  projectLinks,
  projects,
  type ProjectLinkTarget,
} from "../db/schema";
import { ValidationError } from "../providers/types";

const MAX_NAME = 100;
/** Trần để một workspace không tạo dự án/bí danh vô hạn (chặn lạm dụng, giữ truy vấn gợi ý rẻ). */
export const MAX_PROJECTS_PER_WORKSPACE = 200;
export const MAX_ALIASES_PER_PROJECT = 20;

export interface ProjectView {
  id: string;
  name: string;
  aliases: { id: string; alias: string }[];
}

export interface ProjectLinkView {
  id: string;
  targetType: ProjectLinkTarget;
  conversationId: string | null;
  evidenceItemId: string | null;
  createdBy: string;
  createdAt: Date;
}

function cleanName(raw: string, what: string): { text: string; key: string } {
  const text = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  if (text === "" || text.length > MAX_NAME)
    throw new ValidationError(`${what} phải dài 1-${MAX_NAME} ký tự`);
  return { text, key: nameKeyOf(text) };
}

export function createKnowledgeService({ db }: { db: Db }) {
  async function requireProject(workspaceId: string, projectId: string) {
    if (!UUID.test(projectId)) throw new NotFoundError();
    const [row] = await db
      .select()
      .from(projects)
      .where(
        and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)),
      );
    if (!row) throw new NotFoundError();
    return row;
  }

  return {
    async createProject(input: {
      actorId: string;
      workspaceId: string;
      name: string;
    }): Promise<{ id: string; name: string }> {
      await requireAction(
        db,
        input.actorId,
        input.workspaceId,
        "projects.write",
      );
      const { text, key } = cleanName(input.name, "Tên dự án");
      return db.transaction(async (tx) => {
        const existing = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.workspaceId, input.workspaceId));
        if (existing.length >= MAX_PROJECTS_PER_WORKSPACE)
          throw new ConflictError(
            "project_limit",
            `Mỗi workspace tối đa ${MAX_PROJECTS_PER_WORKSPACE} dự án`,
          );
        // Tên không được trùng bí danh của dự án khác: một cách gọi chỉ trỏ một dự án.
        const [alias] = await tx
          .select({ id: projectAliases.id })
          .from(projectAliases)
          .where(
            and(
              eq(projectAliases.workspaceId, input.workspaceId),
              eq(projectAliases.aliasKey, key),
            ),
          );
        if (alias)
          throw new ConflictError(
            "name_taken",
            "Tên trùng với bí danh của một dự án khác",
          );
        const [row] = await tx
          .insert(projects)
          .values({
            workspaceId: input.workspaceId,
            name: text,
            nameKey: key,
          })
          .onConflictDoNothing({
            target: [projects.workspaceId, projects.nameKey],
          })
          .returning({ id: projects.id, name: projects.name });
        if (!row)
          throw new ConflictError("name_taken", "Đã có dự án trùng tên");
        return row;
      });
    },

    async list(input: {
      actorId: string;
      workspaceId: string;
    }): Promise<ProjectView[]> {
      await requireAction(
        db,
        input.actorId,
        input.workspaceId,
        "projects.read",
      );
      const ps = await db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(eq(projects.workspaceId, input.workspaceId))
        .orderBy(asc(projects.nameKey), asc(projects.id));
      const as = await db
        .select({
          id: projectAliases.id,
          projectId: projectAliases.projectId,
          alias: projectAliases.alias,
        })
        .from(projectAliases)
        .where(eq(projectAliases.workspaceId, input.workspaceId))
        .orderBy(asc(projectAliases.aliasKey));
      return ps.map((p) => ({
        ...p,
        aliases: as
          .filter((a) => a.projectId === p.id)
          .map((a) => ({ id: a.id, alias: a.alias })),
      }));
    },

    async addAlias(input: {
      actorId: string;
      workspaceId: string;
      projectId: string;
      alias: string;
    }): Promise<{ id: string; alias: string }> {
      await requireAction(
        db,
        input.actorId,
        input.workspaceId,
        "projects.write",
      );
      const { text, key } = cleanName(input.alias, "Bí danh");
      await requireProject(input.workspaceId, input.projectId);
      return db.transaction(async (tx) => {
        const mine = await tx
          .select({ id: projectAliases.id })
          .from(projectAliases)
          .where(eq(projectAliases.projectId, input.projectId));
        if (mine.length >= MAX_ALIASES_PER_PROJECT)
          throw new ConflictError(
            "alias_limit",
            `Mỗi dự án tối đa ${MAX_ALIASES_PER_PROJECT} bí danh`,
          );
        // Không trùng tên của BẤT KỲ dự án nào (kể cả chính nó: bí danh giống tên là thừa).
        const [clash] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.workspaceId, input.workspaceId),
              eq(projects.nameKey, key),
            ),
          );
        if (clash)
          throw new ConflictError(
            "alias_taken",
            "Bí danh trùng với tên một dự án",
          );
        const [row] = await tx
          .insert(projectAliases)
          .values({
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            alias: text,
            aliasKey: key,
          })
          .onConflictDoNothing({
            target: [projectAliases.workspaceId, projectAliases.aliasKey],
          })
          .returning({ id: projectAliases.id, alias: projectAliases.alias });
        if (!row)
          throw new ConflictError("alias_taken", "Bí danh đã được dùng");
        return row;
      });
    },

    async removeAlias(input: {
      actorId: string;
      workspaceId: string;
      aliasId: string;
    }): Promise<void> {
      await requireAction(
        db,
        input.actorId,
        input.workspaceId,
        "projects.write",
      );
      if (!UUID.test(input.aliasId)) throw new NotFoundError();
      const rows = await db
        .delete(projectAliases)
        .where(
          and(
            eq(projectAliases.id, input.aliasId),
            eq(projectAliases.workspaceId, input.workspaceId),
          ),
        )
        .returning({ id: projectAliases.id });
      if (rows.length === 0) throw new NotFoundError();
    },

    /** Gắn một hội thoại hoặc một bằng chứng vào dự án (cùng workspace). Gắn lại là lũy đẳng. */
    async link(input: {
      actorId: string;
      workspaceId: string;
      projectId: string;
      target:
        | { type: "conversation"; conversationId: string }
        | { type: "evidence"; evidenceItemId: string };
    }): Promise<{ id: string; created: boolean }> {
      await requireAction(
        db,
        input.actorId,
        input.workspaceId,
        "projects.write",
      );
      await requireProject(input.workspaceId, input.projectId);
      const t = input.target;
      const targetId =
        t.type === "conversation" ? t.conversationId : t.evidenceItemId;
      if (!UUID.test(targetId)) throw new NotFoundError();
      // Đích phải thuộc đúng workspace: sai workspace và không tồn tại đều là NotFound.
      const [found] =
        t.type === "conversation"
          ? await db
              .select({ id: conversations.id })
              .from(conversations)
              .where(
                and(
                  eq(conversations.id, targetId),
                  eq(conversations.workspaceId, input.workspaceId),
                ),
              )
          : await db
              .select({ id: evidenceItems.id })
              .from(evidenceItems)
              .where(
                and(
                  eq(evidenceItems.id, targetId),
                  eq(evidenceItems.workspaceId, input.workspaceId),
                ),
              );
      if (!found) throw new NotFoundError();
      const values = {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        targetType: t.type,
        conversationId: t.type === "conversation" ? targetId : null,
        evidenceItemId: t.type === "evidence" ? targetId : null,
        createdBy: input.actorId,
      };
      const inserted = await db
        .insert(projectLinks)
        .values(values)
        .onConflictDoNothing()
        .returning({ id: projectLinks.id });
      if (inserted[0]) return { id: inserted[0].id, created: true };
      const [dup] = await db
        .select({ id: projectLinks.id })
        .from(projectLinks)
        .where(
          and(
            eq(projectLinks.projectId, input.projectId),
            t.type === "conversation"
              ? eq(projectLinks.conversationId, targetId)
              : eq(projectLinks.evidenceItemId, targetId),
          ),
        );
      return { id: dup!.id, created: false };
    },

    /** Gỡ liên kết; nguồn (hội thoại, bằng chứng) không bị xoá. */
    async unlink(input: {
      actorId: string;
      workspaceId: string;
      linkId: string;
    }): Promise<void> {
      await requireAction(
        db,
        input.actorId,
        input.workspaceId,
        "projects.write",
      );
      if (!UUID.test(input.linkId)) throw new NotFoundError();
      const rows = await db
        .delete(projectLinks)
        .where(
          and(
            eq(projectLinks.id, input.linkId),
            eq(projectLinks.workspaceId, input.workspaceId),
          ),
        )
        .returning({ id: projectLinks.id });
      if (rows.length === 0) throw new NotFoundError();
    },

    async listLinks(input: {
      actorId: string;
      workspaceId: string;
      projectId: string;
    }): Promise<ProjectLinkView[]> {
      await requireAction(
        db,
        input.actorId,
        input.workspaceId,
        "projects.read",
      );
      await requireProject(input.workspaceId, input.projectId);
      return db
        .select({
          id: projectLinks.id,
          targetType: projectLinks.targetType,
          conversationId: projectLinks.conversationId,
          evidenceItemId: projectLinks.evidenceItemId,
          createdBy: projectLinks.createdBy,
          createdAt: projectLinks.createdAt,
        })
        .from(projectLinks)
        .where(
          and(
            eq(projectLinks.projectId, input.projectId),
            eq(projectLinks.workspaceId, input.workspaceId),
          ),
        )
        .orderBy(asc(projectLinks.createdAt), asc(projectLinks.id));
    },
  };
}

export type KnowledgeService = ReturnType<typeof createKnowledgeService>;
