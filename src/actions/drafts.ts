import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { requireAction, UUID } from "../auth/access";
import { ConflictError, NotFoundError } from "../auth/errors";
import type { Db } from "../auth/members";
import {
  actionLedger,
  conversations,
  draftVersions,
  drafts,
  type ActionState,
  type DraftSource,
  type DraftStatus,
} from "../db/schema";
import { ValidationError } from "../providers/types";

export const MAX_DRAFT_CHARS = 4000;
/** Hành động gửi đang dở hoặc chưa rõ kết quả: tin có thể đã đi, nên không cho bỏ nháp. */
const PENDING_SEND: ActionState[] = [
  "dispatching",
  "cancel_requested",
  "send_unknown",
];

export interface DraftVersionView {
  version: number;
  text: string;
  source: DraftSource;
  createdBy: string;
  createdAt: Date;
}

export interface DraftView {
  id: string;
  conversationId: string;
  status: DraftStatus;
  currentVersion: number;
  /** Nội dung của phiên bản hiện tại. */
  text: string;
  source: DraftSource;
  createdBy: string;
  updatedAt: Date;
}

function cleanText(raw: string): string {
  if (typeof raw !== "string")
    throw new ValidationError("Nội dung không hợp lệ");
  const text = raw.normalize("NFC").trim();
  if (text === "" || text.length > MAX_DRAFT_CHARS)
    throw new ValidationError(`Nội dung phải dài 1-${MAX_DRAFT_CHARS} ký tự`);
  return text;
}

/**
 * Bản nháp có phiên bản. Mọi lần sửa tạo phiên bản mới (không ghi đè) và dùng khoá lạc quan: sửa phải nêu phiên bản đang
 * dựa vào, hai người sửa cùng lúc thì người sau nhận xung đột thay vì lặng lẽ đè lên bản của người kia.
 * `source: "ai"` chỉ do mã server truyền vào (gợi ý của mô hình); người vẫn phải duyệt trước khi gửi.
 */
export function createDraftService({
  db,
  now = () => new Date(),
}: {
  db: Db;
  now?: () => Date;
}) {
  async function load(workspaceId: string, draftId: string) {
    if (!UUID.test(draftId)) throw new NotFoundError();
    const [d] = await db
      .select()
      .from(drafts)
      .where(and(eq(drafts.id, draftId), eq(drafts.workspaceId, workspaceId)));
    if (!d) throw new NotFoundError();
    return d;
  }

  async function view(d: typeof drafts.$inferSelect): Promise<DraftView> {
    const [v] = await db
      .select()
      .from(draftVersions)
      .where(
        and(
          eq(draftVersions.draftId, d.id),
          eq(draftVersions.version, d.currentVersion),
        ),
      );
    return {
      id: d.id,
      conversationId: d.conversationId,
      status: d.status,
      currentVersion: d.currentVersion,
      text: v!.text,
      source: v!.source,
      createdBy: d.createdBy,
      updatedAt: d.updatedAt,
    };
  }

  return {
    async create(input: {
      actorId: string;
      workspaceId: string;
      conversationId: string;
      text: string;
      source?: DraftSource;
    }): Promise<DraftView> {
      await requireAction(db, input.actorId, input.workspaceId, "inbox.reply");
      const text = cleanText(input.text);
      if (!UUID.test(input.conversationId)) throw new NotFoundError();
      const [conv] = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, input.conversationId),
            eq(conversations.workspaceId, input.workspaceId),
          ),
        );
      if (!conv) throw new NotFoundError();
      const d = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(drafts)
          .values({
            workspaceId: input.workspaceId,
            conversationId: conv.id,
            createdBy: input.actorId,
            updatedAt: now(),
          })
          .returning();
        await tx.insert(draftVersions).values({
          workspaceId: input.workspaceId,
          draftId: row!.id,
          version: 1,
          text,
          source: input.source ?? "human",
          createdBy: input.actorId,
        });
        return row!;
      });
      return view(d);
    },

    /** Sửa nháp: tạo phiên bản `baseVersion + 1`. Xung đột nếu nháp đã sang phiên bản khác hoặc không còn mở. */
    async edit(input: {
      actorId: string;
      workspaceId: string;
      draftId: string;
      baseVersion: number;
      text: string;
      source?: DraftSource;
    }): Promise<DraftView> {
      await requireAction(db, input.actorId, input.workspaceId, "inbox.reply");
      const text = cleanText(input.text);
      if (!Number.isInteger(input.baseVersion) || input.baseVersion < 1)
        throw new ValidationError("Phiên bản nền không hợp lệ");
      const current = await load(input.workspaceId, input.draftId);
      const d = await db.transaction(async (tx) => {
        // Cập nhật có điều kiện là khoá: chỉ một người thắng khi hai người sửa cùng phiên bản nền.
        const [row] = await tx
          .update(drafts)
          .set({ currentVersion: input.baseVersion + 1, updatedAt: now() })
          .where(
            and(
              eq(drafts.id, current.id),
              eq(drafts.currentVersion, input.baseVersion),
              eq(drafts.status, "open"),
            ),
          )
          .returning();
        if (!row) return null;
        await tx.insert(draftVersions).values({
          workspaceId: input.workspaceId,
          draftId: row.id,
          version: row.currentVersion,
          text,
          source: input.source ?? "human",
          createdBy: input.actorId,
        });
        return row;
      });
      if (!d) {
        const fresh = await load(input.workspaceId, input.draftId);
        if (fresh.status !== "open")
          throw new ConflictError("draft_closed", "Bản nháp đã đóng");
        throw new ConflictError(
          "version_conflict",
          `Bản nháp đã ở phiên bản ${fresh.currentVersion}; tải lại rồi sửa`,
        );
      }
      return view(d);
    },

    /**
     * Bỏ nháp (không xoá lịch sử). Nháp đã gửi không bỏ được. Cùng giao dịch: huỷ hành động gửi đang `queued` của nháp
     * (chưa gửi gì); nháp có hành động đang gửi dở hoặc chưa rõ kết quả thì TỪ CHỐI — không thể bảo đảm tin chưa đi.
     * Thứ tự huỷ-rồi-kiểm là cố ý: hành động nào bị nhận việc trước khi huỷ đều thấy được ở bước kiểm (ADR-0006).
     */
    async discard(input: {
      actorId: string;
      workspaceId: string;
      draftId: string;
    }): Promise<DraftView> {
      await requireAction(db, input.actorId, input.workspaceId, "inbox.reply");
      const current = await load(input.workspaceId, input.draftId);
      const row = await db.transaction(async (tx) => {
        const [d] = await tx
          .update(drafts)
          .set({ status: "discarded", updatedAt: now() })
          .where(and(eq(drafts.id, current.id), eq(drafts.status, "open")))
          .returning();
        if (!d) throw new ConflictError("draft_closed", "Bản nháp đã đóng");
        await tx
          .update(actionLedger)
          .set({
            state: "cancelled",
            errorCode: "draft_discarded",
            finishedAt: now(),
          })
          .where(
            and(
              eq(actionLedger.draftId, d.id),
              eq(actionLedger.state, "queued"),
            ),
          );
        const [pending] = await tx
          .select({ id: actionLedger.id })
          .from(actionLedger)
          .where(
            and(
              eq(actionLedger.draftId, d.id),
              inArray(actionLedger.state, PENDING_SEND),
            ),
          )
          .limit(1);
        // Ném trong giao dịch = hoàn tác cả việc bỏ nháp lẫn việc huỷ ở trên.
        if (pending)
          throw new ConflictError(
            "draft_send_pending",
            "Nháp đang được gửi hoặc chưa rõ đã gửi hay chưa",
          );
        return d;
      });
      return view(row);
    },

    async get(input: {
      actorId: string;
      workspaceId: string;
      draftId: string;
    }): Promise<DraftView & { versions: DraftVersionView[] }> {
      await requireAction(db, input.actorId, input.workspaceId, "inbox.read");
      const d = await load(input.workspaceId, input.draftId);
      const versions = await db
        .select({
          version: draftVersions.version,
          text: draftVersions.text,
          source: draftVersions.source,
          createdBy: draftVersions.createdBy,
          createdAt: draftVersions.createdAt,
        })
        .from(draftVersions)
        .where(eq(draftVersions.draftId, d.id))
        .orderBy(asc(draftVersions.version));
      return { ...(await view(d)), versions };
    },

    async listForConversation(input: {
      actorId: string;
      workspaceId: string;
      conversationId: string;
    }): Promise<DraftView[]> {
      await requireAction(db, input.actorId, input.workspaceId, "inbox.read");
      if (!UUID.test(input.conversationId)) throw new NotFoundError();
      const rows = await db
        .select()
        .from(drafts)
        .where(
          and(
            eq(drafts.conversationId, input.conversationId),
            eq(drafts.workspaceId, input.workspaceId),
          ),
        )
        .orderBy(desc(drafts.updatedAt), desc(drafts.id));
      return Promise.all(rows.map(view));
    },
  };
}

export type DraftService = ReturnType<typeof createDraftService>;
