import { createHash } from "node:crypto";

import { and, eq, notExists, sql } from "drizzle-orm";

import { requireAction, UUID } from "../auth/access";
import { NotFoundError } from "../auth/errors";
import type { Db } from "../auth/members";
import {
  EVIDENCE_CONTENT_TYPES,
  EVIDENCE_SOURCES,
  evidenceBlobs,
  evidenceItems,
  messages,
  searchDocuments,
  type EvidenceContentType,
  type EvidenceSource,
} from "../db/schema";
import { ValidationError } from "../providers/types";
import { fold } from "../search/fold";
import type { BlobStore } from "./blob-store";

/** Trần một bản gốc: tin nhắn, issue, Markdown đều nhỏ; chặn nhập nhầm tệp khổng lồ vào RAM/đĩa. */
export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
const MAX_EXTERNAL_ID = 500;

/** Nội dung đọc lại không khớp hash đã lưu: đĩa hỏng hoặc bị sửa — không bao giờ trả nội dung đó như bằng chứng. */
export class IntegrityError extends Error {
  readonly code = "integrity";
  constructor() {
    super("Nội dung bằng chứng không khớp hash đã lưu");
    this.name = "IntegrityError";
  }
}

export interface IngestInput {
  workspaceId: string;
  source: EvidenceSource;
  /** Id của mục bên nguồn; cùng id + cùng nội dung là một lần (lũy đẳng). */
  externalId: string;
  content: string | Uint8Array;
  contentType: EvidenceContentType;
  /** Lúc nội dung xảy ra ở nguồn. */
  observedAt: Date;
  /** Bắt buộc với nguồn `message` (và chỉ với nguồn đó): để bản sao bị xoá cùng tin. */
  messageId?: string;
}

export interface IngestResult {
  itemId: string;
  blobId: string;
  sha256: string;
  /** Nội dung này đã có trong workspace (blob dùng lại). */
  blobReused: boolean;
  /** Cùng (nguồn, id ngoài, nội dung) đã được nhập trước đó: không tạo lần xuất hiện mới. */
  duplicate: boolean;
}

export interface EvidenceItemView {
  id: string;
  source: EvidenceSource;
  externalId: string;
  sha256: string;
  sizeBytes: number;
  contentType: EvidenceContentType;
  observedAt: Date;
  createdAt: Date;
}

const bytesOf = (c: string | Uint8Array) =>
  typeof c === "string" ? new TextEncoder().encode(c.normalize("NFC")) : c;

export function createEvidenceService({
  db,
  store,
}: {
  db: Db;
  store: BlobStore;
}) {
  /**
   * Nhập một bản gốc. Thứ tự: kiểm đầu vào → ghi nội dung vào kho (lũy đẳng, theo hash) → một giao dịch ghi blob và lần
   * xuất hiện. Lỗi ở bước nào cũng không để lại dòng DB trỏ vào nội dung không có; tệp mồ côi (ghi xong rồi DB lỗi) vô hại
   * vì địa chỉ theo nội dung và không dòng nào trỏ tới.
   */
  async function ingestRaw(input: IngestInput): Promise<IngestResult> {
    if (!UUID.test(input.workspaceId)) throw new NotFoundError();
    if (!(EVIDENCE_SOURCES as readonly string[]).includes(input.source))
      throw new ValidationError("Nguồn bằng chứng không hợp lệ");
    if (
      !(EVIDENCE_CONTENT_TYPES as readonly string[]).includes(input.contentType)
    )
      throw new ValidationError("Loại nội dung không được hỗ trợ");
    const externalId = input.externalId.normalize("NFC").trim();
    if (externalId === "" || externalId.length > MAX_EXTERNAL_ID)
      throw new ValidationError(`Id nguồn phải dài 1-${MAX_EXTERNAL_ID} ký tự`);
    if (Number.isNaN(input.observedAt.getTime()))
      throw new ValidationError("Thời điểm nguồn không hợp lệ");
    const bytes = bytesOf(input.content);
    if (bytes.length === 0)
      throw new ValidationError("Nội dung bằng chứng không được rỗng");
    if (bytes.length > MAX_EVIDENCE_BYTES)
      throw new ValidationError(
        `Nội dung vượt trần ${MAX_EVIDENCE_BYTES} byte`,
      );
    if ((input.source === "message") !== (input.messageId !== undefined))
      throw new ValidationError(
        "Bằng chứng nguồn `message` phải kèm id tin nhắn (và chỉ nguồn đó)",
      );
    if (input.messageId !== undefined && !UUID.test(input.messageId))
      throw new ValidationError("Id tin nhắn không hợp lệ");
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    return db.transaction(async (tx) => {
      // Khoá theo hash tới hết giao dịch: việc quét blob mồ côi cùng khoá nên không xoá tệp ngay lúc ta vừa ghi.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${sha256}, 0))`,
      );
      await store.put(sha256, bytes);
      const inserted = await tx
        .insert(evidenceBlobs)
        .values({
          workspaceId: input.workspaceId,
          sha256,
          sizeBytes: bytes.length,
          contentType: input.contentType,
        })
        .onConflictDoNothing({
          target: [evidenceBlobs.workspaceId, evidenceBlobs.sha256],
        })
        .returning({ id: evidenceBlobs.id });
      let blobId = inserted[0]?.id;
      const blobReused = blobId === undefined;
      if (blobId === undefined) {
        const [existing] = await tx
          .select({ id: evidenceBlobs.id })
          .from(evidenceBlobs)
          .where(
            and(
              eq(evidenceBlobs.workspaceId, input.workspaceId),
              eq(evidenceBlobs.sha256, sha256),
            ),
          );
        blobId = existing!.id;
      }

      const item = await tx
        .insert(evidenceItems)
        .values({
          workspaceId: input.workspaceId,
          blobId,
          messageId: input.messageId ?? null,
          source: input.source,
          externalId,
          observedAt: input.observedAt,
        })
        .onConflictDoNothing({
          target: [
            evidenceItems.workspaceId,
            evidenceItems.source,
            evidenceItems.externalId,
            evidenceItems.blobId,
          ],
        })
        .returning({ id: evidenceItems.id });
      if (item[0]) {
        // Chỉ mục tìm kiếm cùng giao dịch: bằng chứng mới nào cũng tìm được, lỗi thì không để lại bằng chứng không tìm được.
        await tx
          .insert(searchDocuments)
          .values({
            workspaceId: input.workspaceId,
            evidenceItemId: item[0].id,
            textFolded: fold(new TextDecoder().decode(bytes)),
          })
          .onConflictDoNothing({ target: searchDocuments.evidenceItemId });
        return {
          itemId: item[0].id,
          blobId,
          sha256,
          blobReused,
          duplicate: false,
        };
      }
      const [dup] = await tx
        .select({ id: evidenceItems.id })
        .from(evidenceItems)
        .where(
          and(
            eq(evidenceItems.workspaceId, input.workspaceId),
            eq(evidenceItems.source, input.source),
            eq(evidenceItems.externalId, externalId),
            eq(evidenceItems.blobId, blobId),
          ),
        );
      return {
        itemId: dup!.id,
        blobId,
        sha256,
        blobReused,
        duplicate: true,
      };
    });
  }

  async function loadItem(workspaceId: string, itemId: string) {
    if (!UUID.test(itemId)) throw new NotFoundError();
    const [row] = await db
      .select({
        id: evidenceItems.id,
        source: evidenceItems.source,
        externalId: evidenceItems.externalId,
        observedAt: evidenceItems.observedAt,
        createdAt: evidenceItems.createdAt,
        sha256: evidenceBlobs.sha256,
        sizeBytes: evidenceBlobs.sizeBytes,
        contentType: evidenceBlobs.contentType,
      })
      .from(evidenceItems)
      .innerJoin(evidenceBlobs, eq(evidenceItems.blobId, evidenceBlobs.id))
      .where(
        and(
          eq(evidenceItems.id, itemId),
          eq(evidenceItems.workspaceId, workspaceId),
        ),
      );
    if (!row) throw new NotFoundError();
    return row;
  }

  return {
    /**
     * Tạo bằng chứng cho các tin nhắn chưa có (đồng bộ và webhook chỉ ghi `messages`; hàm này tự lành nếu lần trước lỗi
     * giữa chừng). Bỏ qua tin không có chữ hoặc quá trần. Lũy đẳng. Chỉ cho mã server.
     */
    async backfillMessages({
      workspaceId,
      socialAccountId,
      limit = 200,
    }: {
      workspaceId: string;
      socialAccountId?: string;
      limit?: number;
    }): Promise<{ ingested: number; failed: number; more: boolean }> {
      const rows = await db
        .select({
          id: messages.id,
          socialAccountId: messages.socialAccountId,
          externalId: messages.externalId,
          text: messages.text,
          sentAt: messages.sentAt,
        })
        .from(messages)
        .where(
          and(
            eq(messages.workspaceId, workspaceId),
            socialAccountId === undefined
              ? undefined
              : eq(messages.socialAccountId, socialAccountId),
            sql`octet_length(${messages.text}) between 1 and ${MAX_EVIDENCE_BYTES}`,
            notExists(
              db
                .select({ one: sql`1` })
                .from(evidenceItems)
                .where(eq(evidenceItems.messageId, messages.id)),
            ),
          ),
        )
        .orderBy(messages.sentAt)
        .limit(limit + 1);
      let ingested = 0;
      let failed = 0;
      for (const m of rows.slice(0, limit)) {
        try {
          await ingestRaw({
            workspaceId,
            source: "message",
            // Id tin chỉ duy nhất trong một tài khoản: gắn thêm tài khoản để khoá ngoài không đụng nhau.
            externalId: `${m.socialAccountId}:${m.externalId}`,
            content: m.text,
            contentType: "text/plain",
            observedAt: m.sentAt,
            messageId: m.id,
          });
          ingested++;
        } catch {
          // Một tin lỗi không chặn tin khác; lượt sau thử lại. Không ghi nội dung tin vào lỗi.
          failed++;
        }
      }
      return { ingested, failed, more: rows.length > limit };
    },

    /**
     * Xoá blob không còn lần xuất hiện nào và tệp của nó nếu không workspace nào khác còn dùng hash đó. Cùng khoá
     * advisory theo hash với `ingest` nên không xoá tệp vừa được ghi. Lũy đẳng; chỉ cho mã server.
     */
    async sweepOrphanBlobs({ limit = 500 }: { limit?: number } = {}): Promise<{
      blobs: number;
      files: number;
    }> {
      const orphans = await db
        .select({ id: evidenceBlobs.id, sha256: evidenceBlobs.sha256 })
        .from(evidenceBlobs)
        .where(
          notExists(
            db
              .select({ one: sql`1` })
              .from(evidenceItems)
              .where(eq(evidenceItems.blobId, evidenceBlobs.id)),
          ),
        )
        .limit(limit);
      let blobs = 0;
      let files = 0;
      for (const o of orphans) {
        await db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${o.sha256}, 0))`,
          );
          const deleted = await tx
            .delete(evidenceBlobs)
            .where(
              and(
                eq(evidenceBlobs.id, o.id),
                notExists(
                  tx
                    .select({ one: sql`1` })
                    .from(evidenceItems)
                    .where(eq(evidenceItems.blobId, o.id)),
                ),
              ),
            )
            .returning({ id: evidenceBlobs.id });
          if (deleted.length === 0) return; // có người vừa dùng lại
          blobs++;
          const [still] = await tx
            .select({ id: evidenceBlobs.id })
            .from(evidenceBlobs)
            .where(eq(evidenceBlobs.sha256, o.sha256))
            .limit(1);
          if (!still) {
            await store.delete(o.sha256);
            files++;
          }
        });
      }
      return { blobs, files };
    },

    /**
     * Xoá tệp nội dung theo hash khi không còn dòng blob nào (của bất kỳ workspace nào) trỏ tới. Dùng sau khi xoá cả
     * workspace: khoá ngoại theo tầng xoá luôn dòng blob nên `sweepOrphanBlobs` không còn thấy chúng, tệp sẽ ở lại.
     * Cùng khoá advisory với `ingest`. Lũy đẳng; chỉ cho mã server.
     */
    async releaseFiles(shas: string[]): Promise<{ files: number }> {
      let files = 0;
      for (const sha of new Set(shas)) {
        await db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${sha}, 0))`,
          );
          const [still] = await tx
            .select({ id: evidenceBlobs.id })
            .from(evidenceBlobs)
            .where(eq(evidenceBlobs.sha256, sha))
            .limit(1);
          if (still) return;
          await store.delete(sha);
          files++;
        });
      }
      return { files };
    },

    /** Dành cho mã server nhập từ nguồn (đồng bộ, webhook, connector): không có người dùng; không đưa ra API. */
    ingestAsSystem: ingestRaw,

    /** Người dùng nhập tay (tài liệu): cần quyền ghi kho. */
    async ingest(input: IngestInput & { actorId: string }) {
      await requireAction(
        db,
        input.actorId,
        input.workspaceId,
        "evidence.write",
      );
      return ingestRaw(input);
    },

    async get(input: {
      actorId: string;
      workspaceId: string;
      itemId: string;
    }): Promise<EvidenceItemView> {
      await requireAction(
        db,
        input.actorId,
        input.workspaceId,
        "evidence.read",
      );
      return loadItem(input.workspaceId, input.itemId);
    },

    /** Đọc nguyên văn; kiểm lại hash trước khi trả (IntegrityError nếu lệch, NotFound nếu nội dung mất). */
    async getContent(input: {
      actorId: string;
      workspaceId: string;
      itemId: string;
    }): Promise<{ item: EvidenceItemView; content: Uint8Array }> {
      await requireAction(
        db,
        input.actorId,
        input.workspaceId,
        "evidence.read",
      );
      const item = await loadItem(input.workspaceId, input.itemId);
      const content = await store.get(item.sha256);
      if (!content) throw new NotFoundError();
      if (createHash("sha256").update(content).digest("hex") !== item.sha256)
        throw new IntegrityError();
      return { item, content };
    },
  };
}

export type EvidenceService = ReturnType<typeof createEvidenceService>;
