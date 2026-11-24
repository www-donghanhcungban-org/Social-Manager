import { and, count, eq, inArray } from "drizzle-orm";

import { recordAudit } from "../audit/record";
import { requireAction, UUID } from "../auth/access";
import { NotFoundError } from "../auth/errors";
import type { Db } from "../auth/members";
import {
  conversations,
  evidenceBlobs,
  evidenceItems,
  inboxItems,
  messages,
  projectAliases,
  projectLinks,
  projects,
} from "../db/schema";
import type { EvidenceService } from "../evidence/service";
import { ValidationError } from "../providers/types";

/** Trần mặc định số dòng một lệnh xoá được chạm (grant `data_delete` của PLAN); vượt thì từ chối, không xoá một phần. */
export const DEFAULT_ERASE_MAX_ROWS = 1000;
/** Trần số mục một lần xuất (grant `data_export`). */
export const DEFAULT_EXPORT_MAX_ROWS = 10_000;

export interface ErasureResult {
  conversations: number;
  messages: number;
  inboxItems: number;
  evidenceItems: number;
  projects: number;
  /** Blob (và tệp nếu không nơi nào khác dùng) đã dọn sau khi xoá. */
  blobs: number;
}

const empty = (): ErasureResult => ({
  conversations: 0,
  messages: 0,
  inboxItems: 0,
  evidenceItems: 0,
  projects: 0,
  blobs: 0,
});

export interface ProjectExport {
  exportedAt: string;
  project: { name: string; aliases: string[] };
  links: {
    targetType: string;
    conversationExternalId: string | null;
    evidenceExternalId: string | null;
  }[];
  items: {
    source: string;
    externalId: string;
    observedAt: string;
    sha256: string;
    content: string;
  }[];
}

/**
 * Xoá và xuất dữ liệu xuyên mọi lớp (H5, Luật 91/2025): xoá đi qua hội thoại → tin nhắn → bằng chứng → mục hộp thư →
 * liên kết dự án → blob/tệp mồ côi. Lệnh xoá chạy trong một giao dịch và có trần số dòng: vượt trần thì không xoá gì.
 */
export function createErasureService({
  db,
  evidence,
  now = () => new Date(),
}: {
  db: Db;
  evidence: Pick<EvidenceService, "getContent" | "sweepOrphanBlobs">;
  now?: () => Date;
}) {
  function checkMax(maxRows: number) {
    if (!Number.isInteger(maxRows) || maxRows < 1)
      throw new ValidationError("Trần số dòng phải là số nguyên dương");
  }

  async function sweep(result: ErasureResult) {
    // Lặp tới khi hết: mỗi lần quét có trần lô; kết quả lũy đẳng.
    for (let i = 0; i < 20; i++) {
      const r = await evidence.sweepOrphanBlobs({ limit: 500 });
      result.blobs += r.blobs;
      if (r.blobs < 500) break;
    }
    return result;
  }

  async function eraseConversationRows(
    tx: Db,
    workspaceId: string,
    conversationId: string,
    budget: { left: number },
    out: ErasureResult,
  ) {
    const [conv] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.workspaceId, workspaceId),
        ),
      );
    if (!conv) throw new NotFoundError();
    const [{ n: msgs } = { n: 0 }] = await tx
      .select({ n: count() })
      .from(messages)
      .where(eq(messages.conversationId, conv.id));
    const [{ n: evs } = { n: 0 }] = await tx
      .select({ n: count() })
      .from(evidenceItems)
      .innerJoin(messages, eq(evidenceItems.messageId, messages.id))
      .where(eq(messages.conversationId, conv.id));
    const inbox = await tx
      .delete(inboxItems)
      .where(
        and(
          eq(inboxItems.socialAccountId, conv.socialAccountId),
          eq(inboxItems.kind, "dm"),
          eq(inboxItems.externalId, conv.externalId),
        ),
      )
      .returning({ id: inboxItems.id });
    const total = 1 + msgs + evs + inbox.length;
    budget.left -= total;
    if (budget.left < 0)
      throw new ValidationError(
        "Số dòng cần xoá vượt trần cho phép; chia nhỏ yêu cầu hoặc nâng trần có chủ đích",
      );
    await tx.delete(conversations).where(eq(conversations.id, conv.id));
    out.conversations += 1;
    out.messages += msgs;
    out.evidenceItems += evs;
    out.inboxItems += inbox.length;
  }

  return {
    /** Xoá một hội thoại và mọi bản sao của nó. Chỉ owner. Không đảo ngược. */
    async eraseConversation(input: {
      actorId: string;
      workspaceId: string;
      conversationId: string;
      maxRows?: number;
    }): Promise<ErasureResult> {
      await requireAction(db, input.actorId, input.workspaceId, "data.erase");
      const maxRows = input.maxRows ?? DEFAULT_ERASE_MAX_ROWS;
      checkMax(maxRows);
      if (!UUID.test(input.conversationId)) throw new NotFoundError();
      const out = empty();
      await db.transaction(async (tx) => {
        await eraseConversationRows(
          tx as unknown as Db,
          input.workspaceId,
          input.conversationId,
          { left: maxRows },
          out,
        );
        await recordAudit(tx as unknown as Db, {
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          action: "data.erased",
          targetType: "conversation",
          targetId: input.conversationId,
        });
      });
      return sweep(out);
    },

    /**
     * Xoá một bằng chứng không phải tin nhắn (tài liệu, GitHub). Bằng chứng của tin nhắn xoá bằng cách xoá hội thoại —
     * xoá riêng nó sẽ bị `backfillMessages` tạo lại. Chỉ owner.
     */
    async eraseEvidenceItem(input: {
      actorId: string;
      workspaceId: string;
      itemId: string;
    }): Promise<ErasureResult> {
      await requireAction(db, input.actorId, input.workspaceId, "data.erase");
      if (!UUID.test(input.itemId)) throw new NotFoundError();
      const out = empty();
      await db.transaction(async (tx) => {
        const [item] = await tx
          .select({ id: evidenceItems.id, source: evidenceItems.source })
          .from(evidenceItems)
          .where(
            and(
              eq(evidenceItems.id, input.itemId),
              eq(evidenceItems.workspaceId, input.workspaceId),
            ),
          );
        if (!item) throw new NotFoundError();
        if (item.source === "message")
          throw new ValidationError(
            "Bằng chứng của tin nhắn được xoá bằng cách xoá hội thoại chứa nó",
          );
        await tx.delete(evidenceItems).where(eq(evidenceItems.id, item.id));
        out.evidenceItems = 1;
        await recordAudit(tx as unknown as Db, {
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          action: "data.erased",
          targetType: "evidence_item",
          targetId: input.itemId,
        });
      });
      return sweep(out);
    },

    /**
     * Xoá dự án (cùng bí danh, liên kết). `includeSources` xoá luôn nguồn đã gắn: hội thoại (đầy đủ) và bằng chứng không
     * phải tin nhắn. Một giao dịch, một trần chung. Chỉ owner.
     */
    async eraseProject(input: {
      actorId: string;
      workspaceId: string;
      projectId: string;
      includeSources?: boolean;
      maxRows?: number;
    }): Promise<ErasureResult> {
      await requireAction(db, input.actorId, input.workspaceId, "data.erase");
      const maxRows = input.maxRows ?? DEFAULT_ERASE_MAX_ROWS;
      checkMax(maxRows);
      if (!UUID.test(input.projectId)) throw new NotFoundError();
      const out = empty();
      await db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as Db;
        const [p] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.id, input.projectId),
              eq(projects.workspaceId, input.workspaceId),
            ),
          );
        if (!p) throw new NotFoundError();
        const budget = { left: maxRows };
        if (input.includeSources) {
          const links = await tx
            .select({
              conversationId: projectLinks.conversationId,
              evidenceItemId: projectLinks.evidenceItemId,
            })
            .from(projectLinks)
            .where(eq(projectLinks.projectId, p.id));
          for (const l of links) {
            if (l.conversationId)
              await eraseConversationRows(
                tx,
                input.workspaceId,
                l.conversationId,
                budget,
                out,
              );
          }
          const evIds = links
            .map((l) => l.evidenceItemId)
            .filter((x): x is string => x !== null);
          if (evIds.length > 0) {
            // Bằng chứng tin nhắn (nếu có) đã đi theo hội thoại hoặc giữ lại — chỉ xoá nguồn không phải tin nhắn.
            const gone = await tx
              .delete(evidenceItems)
              .where(
                and(
                  inArray(evidenceItems.id, evIds),
                  eq(evidenceItems.workspaceId, input.workspaceId),
                  // `source <> 'message'` qua so sánh liệt kê: tránh xoá bản sao tin mà messages còn giữ.
                  inArray(evidenceItems.source, ["document", "github"]),
                ),
              )
              .returning({ id: evidenceItems.id });
            budget.left -= gone.length;
            out.evidenceItems += gone.length;
          }
        }
        const [{ n: aliasN } = { n: 0 }] = await tx
          .select({ n: count() })
          .from(projectAliases)
          .where(eq(projectAliases.projectId, p.id));
        budget.left -= 1 + aliasN;
        if (budget.left < 0)
          throw new ValidationError(
            "Số dòng cần xoá vượt trần cho phép; chia nhỏ yêu cầu hoặc nâng trần có chủ đích",
          );
        await tx.delete(projects).where(eq(projects.id, p.id));
        out.projects = 1;
        await recordAudit(tx, {
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          action: "data.erased",
          targetType: "project",
          targetId: input.projectId,
          reason: input.includeSources ? "with_sources" : "project_only",
        });
      });
      return sweep(out);
    },

    /**
     * Xuất một dự án ra JSON (tên, bí danh, liên kết, nội dung nguyên văn các bằng chứng liên quan). Không kèm khoá,
     * chữ ký hay mã nội bộ của người dùng. Admin/owner. Trần số mục.
     */
    async exportProject(input: {
      actorId: string;
      workspaceId: string;
      projectId: string;
      maxItems?: number;
    }): Promise<ProjectExport> {
      await requireAction(db, input.actorId, input.workspaceId, "data.export");
      const maxItems = input.maxItems ?? DEFAULT_EXPORT_MAX_ROWS;
      if (!Number.isInteger(maxItems) || maxItems < 1)
        throw new ValidationError("Trần số mục phải là số nguyên dương");
      if (!UUID.test(input.projectId)) throw new NotFoundError();
      const [p] = await db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.id, input.projectId),
            eq(projects.workspaceId, input.workspaceId),
          ),
        );
      if (!p) throw new NotFoundError();
      const aliases = await db
        .select({ alias: projectAliases.alias })
        .from(projectAliases)
        .where(eq(projectAliases.projectId, p.id))
        .orderBy(projectAliases.aliasKey);
      const links = await db
        .select({
          targetType: projectLinks.targetType,
          conversationExternalId: conversations.externalId,
          evidenceExternalId: evidenceItems.externalId,
          evidenceItemId: projectLinks.evidenceItemId,
          conversationId: projectLinks.conversationId,
        })
        .from(projectLinks)
        .leftJoin(
          conversations,
          eq(projectLinks.conversationId, conversations.id),
        )
        .leftJoin(
          evidenceItems,
          eq(projectLinks.evidenceItemId, evidenceItems.id),
        )
        .where(eq(projectLinks.projectId, p.id))
        .orderBy(projectLinks.createdAt, projectLinks.id);

      // Mục cần xuất: bằng chứng gắn trực tiếp + bằng chứng tin của hội thoại đã gắn.
      const direct = links
        .map((l) => l.evidenceItemId)
        .filter((x): x is string => x !== null);
      const convIds = links
        .map((l) => l.conversationId)
        .filter((x): x is string => x !== null);
      const viaConv =
        convIds.length === 0
          ? []
          : await db
              .select({ id: evidenceItems.id })
              .from(evidenceItems)
              .innerJoin(messages, eq(evidenceItems.messageId, messages.id))
              .where(inArray(messages.conversationId, convIds));
      const ids = [...new Set([...direct, ...viaConv.map((r) => r.id)])];
      if (ids.length > maxItems)
        throw new ValidationError(
          `Dự án có ${ids.length} mục, vượt trần xuất ${maxItems}`,
        );
      await recordAudit(db, {
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: "data.exported",
        targetType: "project",
        targetId: input.projectId,
        reason: `items=${ids.length}`,
      });
      const rows =
        ids.length === 0
          ? []
          : await db
              .select({
                id: evidenceItems.id,
                source: evidenceItems.source,
                externalId: evidenceItems.externalId,
                observedAt: evidenceItems.observedAt,
                sha256: evidenceBlobs.sha256,
              })
              .from(evidenceItems)
              .innerJoin(
                evidenceBlobs,
                eq(evidenceItems.blobId, evidenceBlobs.id),
              )
              .where(inArray(evidenceItems.id, ids))
              .orderBy(evidenceItems.observedAt, evidenceItems.id);
      const items: ProjectExport["items"] = [];
      for (const r of rows) {
        const { content } = await evidence.getContent({
          actorId: input.actorId,
          workspaceId: input.workspaceId,
          itemId: r.id,
        });
        items.push({
          source: r.source,
          externalId: r.externalId,
          observedAt: r.observedAt.toISOString(),
          sha256: r.sha256,
          content: new TextDecoder().decode(content),
        });
      }
      return {
        exportedAt: now().toISOString(),
        project: { name: p.name, aliases: aliases.map((a) => a.alias) },
        links: links.map((l) => ({
          targetType: l.targetType,
          conversationExternalId: l.conversationExternalId,
          evidenceExternalId: l.evidenceExternalId,
        })),
        items,
      };
    },
  };
}

export type ErasureService = ReturnType<typeof createErasureService>;
