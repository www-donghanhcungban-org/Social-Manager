import { and, desc, eq, exists, notExists, or, sql } from "drizzle-orm";

import { requireAction, UUID } from "../auth/access";
import { NotFoundError } from "../auth/errors";
import type { Db } from "../auth/members";
import {
  evidenceItems,
  messages,
  projectLinks,
  projects,
  searchDocuments,
  type EvidenceSource,
} from "../db/schema";
import type { EvidenceService } from "../evidence/service";
import { ValidationError } from "../providers/types";
import { fold, queryTokens } from "./fold";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const SNIPPET_RADIUS = 80;

export interface SearchHit {
  itemId: string;
  source: EvidenceSource;
  externalId: string;
  observedAt: Date;
  score: number;
  /** Đoạn trích lấy từ NGUYÊN VĂN quanh chỗ khớp; null nếu không đọc được nội dung. */
  snippet: string | null;
}

/** Đoạn trích quanh lần xuất hiện đầu tiên của một từ khoá; vị trí khớp vì `fold` giữ độ dài theo ký tự. */
export function snippetOf(original: string, tokens: string[]): string {
  const chars = Array.from(original.normalize("NFC"));
  const folded = Array.from(fold(original));
  const text = folded.join("");
  let at = -1;
  for (const t of tokens) {
    const i = text.indexOf(t);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) at = 0;
  // `at` là chỉ số UTF-16 trong chuỗi đã bỏ dấu; đổi sang chỉ số theo ký tự
  const charAt = Array.from(text.slice(0, at)).length;
  const from = Math.max(0, charAt - SNIPPET_RADIUS);
  const to = Math.min(chars.length, charAt + SNIPPET_RADIUS);
  const body = chars.slice(from, to).join("").replace(/\s+/g, " ").trim();
  return `${from > 0 ? "…" : ""}${body}${to < chars.length ? "…" : ""}`;
}

export function createSearchService({
  db,
  evidence,
}: {
  db: Db;
  evidence: Pick<EvidenceService, "getContent">;
}) {
  return {
    /**
     * Tìm toàn văn có dấu hoặc không dấu, khớp tiền tố (gõ dở vẫn tìm thấy), mọi từ phải có mặt. Chỉ trả bằng chứng của
     * workspace và — mặc định — chỉ phiên bản MỚI NHẤT của mỗi (nguồn, id ngoài). Truy vấn rỗng/chỉ dấu câu trả mảng rỗng.
     */
    async search(input: {
      actorId: string;
      workspaceId: string;
      query: string;
      projectId?: string;
      limit?: number;
      /** Gồm cả phiên bản cũ của cùng một mục (mặc định không). */
      allVersions?: boolean;
      /**
       * `all` (mặc định): mọi từ phải có mặt. `any`: chỉ cần một từ, xếp hạng theo độ khớp, bỏ từ dừng — cho câu hỏi tự
       * nhiên (truy xuất cho hỏi đáp).
       */
      match?: "all" | "any";
    }): Promise<SearchHit[]> {
      await requireAction(
        db,
        input.actorId,
        input.workspaceId,
        "evidence.read",
      );
      if (input.projectId !== undefined) {
        if (!UUID.test(input.projectId)) throw new NotFoundError();
        const [p] = await db
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.id, input.projectId),
              eq(projects.workspaceId, input.workspaceId),
            ),
          );
        if (!p) throw new NotFoundError();
      }
      const limit = Math.min(
        Math.max(Math.trunc(input.limit ?? DEFAULT_LIMIT) || 1, 1),
        MAX_LIMIT,
      );
      if (typeof input.query !== "string")
        throw new ValidationError("Truy vấn không hợp lệ");
      const any = input.match === "any";
      const tokens = queryTokens(input.query, 10, { dropStopwords: any });
      if (tokens.length === 0) return [];
      // Từ đã là chữ/số Unicode (không còn dấu nháy, dấu cách hay toán tử) nên ghép tsquery an toàn.
      const tsquery = sql`to_tsquery('simple', ${tokens.map((t) => `${t}:*`).join(any ? " | " : " & ")})`;
      const vector = sql`to_tsvector('simple', ${searchDocuments.textFolded})`;

      const e2 = db
        .select({ one: sql`1` })
        .from(sql`${evidenceItems} as e2`)
        .where(
          sql`e2.workspace_id = ${evidenceItems.workspaceId}
            and e2.source = ${evidenceItems.source}
            and e2.external_id = ${evidenceItems.externalId}
            and (e2.created_at, e2.id) > (${evidenceItems.createdAt}, ${evidenceItems.id})`,
        );

      const conds = [
        eq(searchDocuments.workspaceId, input.workspaceId),
        sql`${vector} @@ ${tsquery}`,
        input.allVersions ? undefined : notExists(e2),
        input.projectId === undefined
          ? undefined
          : or(
              exists(
                db
                  .select({ one: sql`1` })
                  .from(projectLinks)
                  .where(
                    and(
                      eq(projectLinks.projectId, input.projectId),
                      eq(projectLinks.evidenceItemId, evidenceItems.id),
                    ),
                  ),
              ),
              exists(
                db
                  .select({ one: sql`1` })
                  .from(messages)
                  .innerJoin(
                    projectLinks,
                    eq(projectLinks.conversationId, messages.conversationId),
                  )
                  .where(
                    and(
                      eq(messages.id, evidenceItems.messageId),
                      eq(projectLinks.projectId, input.projectId),
                    ),
                  ),
              ),
            ),
      ];
      const score = sql<number>`ts_rank(${vector}, ${tsquery})`;
      const rows = await db
        .select({
          itemId: evidenceItems.id,
          source: evidenceItems.source,
          externalId: evidenceItems.externalId,
          observedAt: evidenceItems.observedAt,
          score,
        })
        .from(searchDocuments)
        .innerJoin(
          evidenceItems,
          eq(searchDocuments.evidenceItemId, evidenceItems.id),
        )
        .where(and(...conds))
        .orderBy(
          desc(score),
          desc(evidenceItems.observedAt),
          desc(evidenceItems.id),
        )
        .limit(limit);

      const hits: SearchHit[] = [];
      for (const r of rows) {
        let snippet: string | null = null;
        try {
          const { content } = await evidence.getContent({
            actorId: input.actorId,
            workspaceId: input.workspaceId,
            itemId: r.itemId,
          });
          snippet = snippetOf(new TextDecoder().decode(content), tokens);
        } catch {
          // Không đọc được/lệch hash: vẫn trả mục (người dùng thấy có kết quả) nhưng KHÔNG kèm đoạn trích tin cậy.
          snippet = null;
        }
        hits.push({ ...r, score: Number(r.score), snippet });
      }
      return hits;
    },

    /**
     * Dựng chỉ mục cho bằng chứng chưa có (dữ liệu nhập trước khi có chỉ mục, hoặc sau khi lùi migration). Chỉ cho mã
     * server. Lũy đẳng; trả số mục đã dựng.
     */
    async reindexMissing({
      workspaceId,
      limit = 200,
      readRaw,
    }: {
      workspaceId: string;
      limit?: number;
      readRaw: (itemId: string) => Promise<Uint8Array | null>;
    }): Promise<{ indexed: number; more: boolean }> {
      const rows = await db
        .select({ id: evidenceItems.id })
        .from(evidenceItems)
        .where(
          and(
            eq(evidenceItems.workspaceId, workspaceId),
            notExists(
              db
                .select({ one: sql`1` })
                .from(searchDocuments)
                .where(eq(searchDocuments.evidenceItemId, evidenceItems.id)),
            ),
          ),
        )
        .limit(limit + 1);
      let indexed = 0;
      for (const r of rows.slice(0, limit)) {
        const raw = await readRaw(r.id);
        if (!raw) continue;
        await db
          .insert(searchDocuments)
          .values({
            workspaceId,
            evidenceItemId: r.id,
            textFolded: fold(new TextDecoder().decode(raw)),
          })
          .onConflictDoNothing({ target: searchDocuments.evidenceItemId });
        indexed++;
      }
      return { indexed, more: rows.length > limit };
    },
  };
}

export type SearchService = ReturnType<typeof createSearchService>;
