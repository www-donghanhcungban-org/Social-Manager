import { createHash } from "node:crypto";

import { and, asc, count, desc, eq, gt, inArray, max, sql } from "drizzle-orm";

import { requireAction, UUID } from "../auth/access";
import { ConflictError, NotFoundError } from "../auth/errors";
import type { Db } from "../auth/members";
import {
  actionLedger,
  conversations,
  draftVersions,
  drafts,
  messages,
  providerConnections,
  socialAccounts,
  workspaces,
  type ActionState,
} from "../db/schema";
import { sendMessage } from "../providers/actions";
import {
  SendRejectedError,
  UnsupportedError,
  ValidationError,
  type Platform,
  type SocialProvider,
} from "../providers/types";
import type { SecretBox } from "../security/secret-box";
import { evaluateSendPolicy, type BlockReason } from "./policy";

const MAX_KEY = 128;
const SAFE_CODE = /^[A-Za-z0-9_.-]{1,64}$/;
/** Hành động còn hiệu lực (tính vào hạn mức giờ và chặn nháp có hành động thứ hai). */
const LIVE_STATES: ActionState[] = [
  "queued",
  "dispatching",
  "cancel_requested",
  "send_unknown",
  "confirmed",
];

/** Băm nội dung đúng như khi ghi sổ (NFC, trim): đối soát so băm, không cần giữ nội dung. */
export const textHashOf = (text: string) =>
  createHash("sha256").update(text.normalize("NFC").trim()).digest("hex");

export interface ActionView {
  id: string;
  state: ActionState;
  blockedReason: string | null;
  errorCode: string | null;
  draftId: string | null;
  draftVersion: number;
  providerMessageIds: string[];
  attempts: number;
  createdBy: string;
  createdAt: Date;
  dispatchedAt: Date | null;
  finishedAt: Date | null;
  reconcileResult: string | null;
}

const view = (r: typeof actionLedger.$inferSelect): ActionView => ({
  id: r.id,
  state: r.state,
  blockedReason: r.blockedReason,
  errorCode: r.errorCode,
  draftId: r.draftId,
  draftVersion: r.draftVersion,
  providerMessageIds: r.providerMessageIds ?? [],
  attempts: r.attempts,
  createdBy: r.createdBy,
  createdAt: r.createdAt,
  dispatchedAt: r.dispatchedAt,
  finishedAt: r.finishedAt,
  reconcileResult: r.reconcileResult,
});

export type DispatchStatus =
  "sent" | "blocked" | "failed" | "send_unknown" | "skipped" | "deferred";

export interface ActionServiceDeps {
  db: Db;
  box: SecretBox;
  resolveProvider: (
    providerId: string,
    credentials: string,
  ) => SocialProvider | undefined;
  /** Cờ hệ thống `OUTBOUND_LIVE`, đọc mỗi lần để tắt giữa chừng có hiệu lực ngay. */
  live: () => boolean;
  now?: () => Date;
}

/** Mã ngắn an toàn của một lỗi bất kỳ: không bao giờ kèm thông báo gốc (có thể chứa URL, khoá, nội dung). */
function safeCodeOf(e: unknown): string {
  const code = (e as { code?: unknown })?.code;
  return typeof code === "string" && SAFE_CODE.test(code) ? code : "internal";
}

/**
 * Sổ hành động gửi tin (H3, H12, H14). Một cửa duy nhất để gửi: yêu cầu → chính sách bằng mã → xếp hàng (dòng sổ bền, lũy
 * đẳng theo khoá) → nhận việc bằng cập nhật có điều kiện → GỌI nhà cung cấp ĐÚNG MỘT LẦN. Kết quả không chắc là
 * `send_unknown` (T-404), không bao giờ gửi lại mù.
 */
export function createActionService(deps: ActionServiceDeps) {
  const { db, box, resolveProvider, live } = deps;
  const now = deps.now ?? (() => new Date());

  async function target(conversationId: string) {
    const [row] = await db
      .select({
        conversationId: conversations.id,
        conversationRef: conversations.externalId,
        workspaceId: conversations.workspaceId,
        platform: socialAccounts.platform,
        accountRef: socialAccounts.externalId,
        provider: providerConnections.provider,
        credentialsEnc: providerConnections.credentialsEnc,
      })
      .from(conversations)
      .innerJoin(
        socialAccounts,
        eq(conversations.socialAccountId, socialAccounts.id),
      )
      .innerJoin(
        providerConnections,
        eq(socialAccounts.connectionId, providerConnections.id),
      )
      .where(eq(conversations.id, conversationId));
    return row ?? null;
  }

  async function lastIncomingAt(conversationId: string) {
    const [r] = await db
      .select({ at: max(messages.sentAt) })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.direction, "incoming"),
        ),
      );
    return r?.at ?? null;
  }

  async function sentLastHour(workspaceId: string) {
    const since = new Date(now().getTime() - 3_600_000);
    const [r] = await db
      .select({ n: count() })
      .from(actionLedger)
      .where(
        and(
          eq(actionLedger.workspaceId, workspaceId),
          gt(actionLedger.createdAt, since),
          inArray(actionLedger.state, LIVE_STATES),
        ),
      );
    return r?.n ?? 0;
  }

  async function draftText(draftId: string | null, version: number) {
    if (draftId === null) return null;
    const [v] = await db
      .select({ text: draftVersions.text })
      .from(draftVersions)
      .where(
        and(
          eq(draftVersions.draftId, draftId),
          eq(draftVersions.version, version),
        ),
      );
    return v?.text ?? null;
  }

  /** Chuyển trạng thái chỉ khi đang ở một trong `from`: hai tiến trình cùng kết thúc một hành động thì chỉ một thắng. */
  async function finish(
    id: string,
    from: ActionState[],
    to: ActionState,
    extra: Partial<typeof actionLedger.$inferInsert> = {},
  ) {
    const [row] = await db
      .update(actionLedger)
      .set({ state: to, finishedAt: now(), ...extra })
      .where(and(eq(actionLedger.id, id), inArray(actionLedger.state, from)))
      .returning();
    return row ?? null;
  }

  async function markDraftSent(draftId: string | null) {
    if (draftId === null) return;
    await db
      .update(drafts)
      .set({ status: "sent", updatedAt: now() })
      .where(and(eq(drafts.id, draftId), eq(drafts.status, "open")));
  }

  return {
    /**
     * Yêu cầu gửi phiên bản hiện tại của một nháp. Lũy đẳng theo `idempotencyKey`: cùng khoá → cùng hành động (kể cả sau
     * khi đã gửi xong). Bị chính sách chặn thì VẪN ghi một dòng `blocked` kèm lý do (dấu vết). Chưa gọi nhà cung cấp:
     * việc gửi do `dispatch` làm.
     */
    async requestSend(input: {
      actorId: string;
      workspaceId: string;
      draftId: string;
      idempotencyKey: string;
    }): Promise<ActionView & { created: boolean }> {
      await requireAction(db, input.actorId, input.workspaceId, "inbox.reply");
      if (
        typeof input.idempotencyKey !== "string" ||
        input.idempotencyKey.length === 0 ||
        input.idempotencyKey.length > MAX_KEY
      )
        throw new ValidationError(`Khoá lũy đẳng phải dài 1-${MAX_KEY} ký tự`);
      if (!UUID.test(input.draftId)) throw new NotFoundError();
      const [draft] = await db
        .select()
        .from(drafts)
        .where(
          and(
            eq(drafts.id, input.draftId),
            eq(drafts.workspaceId, input.workspaceId),
          ),
        );
      if (!draft) throw new NotFoundError();

      // Phát lại cùng khoá: trả hành động cũ (kể cả nháp đã sang `sent`). Khoá dùng cho nháp khác là xung đột.
      const [prior] = await db
        .select()
        .from(actionLedger)
        .where(
          and(
            eq(actionLedger.workspaceId, input.workspaceId),
            eq(actionLedger.idempotencyKey, input.idempotencyKey),
          ),
        );
      if (prior) {
        if (prior.draftId !== draft.id)
          throw new ConflictError(
            "idempotency_conflict",
            "Khoá lũy đẳng đã dùng cho yêu cầu khác",
          );
        return { ...view(prior), created: false };
      }

      if (draft.status !== "open")
        throw new ConflictError("draft_closed", "Bản nháp đã đóng");
      const text = await draftText(draft.id, draft.currentVersion);
      if (text === null) throw new NotFoundError();
      const tgt = await target(draft.conversationId);
      if (!tgt) throw new NotFoundError();
      const [w] = await db
        .select({
          on: workspaces.outboundEnabled,
          max: workspaces.outboundMaxPerHour,
        })
        .from(workspaces)
        .where(eq(workspaces.id, input.workspaceId));
      if (!w) throw new NotFoundError();

      const verdict = evaluateSendPolicy({
        live: live(),
        workspace: { outboundEnabled: w.on, maxPerHour: w.max },
        platform: tgt.platform as Platform,
        lastIncomingAt: await lastIncomingAt(tgt.conversationId),
        text,
        sentLastHour: await sentLastHour(input.workspaceId),
        now: now(),
      });

      const base = {
        workspaceId: input.workspaceId,
        draftId: draft.id,
        draftVersion: draft.currentVersion,
        conversationId: tgt.conversationId,
        recipientRef: tgt.conversationRef,
        textHash: textHashOf(text),
        textBytes: Buffer.byteLength(text),
        idempotencyKey: input.idempotencyKey,
        createdBy: input.actorId,
        // Một đồng hồ cho cả sổ: hạn mức giờ so `created_at` với giờ ứng dụng, không trộn với giờ của CSDL.
        createdAt: now(),
      };
      let inserted;
      try {
        [inserted] = await db
          .insert(actionLedger)
          .values(
            verdict.ok
              ? { ...base, state: "queued" as const }
              : {
                  ...base,
                  state: "blocked" as const,
                  blockedReason: verdict.reason,
                  finishedAt: now(),
                },
          )
          .onConflictDoNothing({
            target: [actionLedger.workspaceId, actionLedger.idempotencyKey],
          })
          .returning();
      } catch (e) {
        // Chỉ mục duy nhất từng phần: nháp này đã có hành động còn hiệu lực dưới một khoá khác.
        if ((e as { cause?: { code?: string } })?.cause?.code === "23505")
          throw new ConflictError(
            "idempotency_conflict",
            "Nháp này đã có một yêu cầu gửi đang xử lý",
          );
        throw e;
      }
      if (inserted) return { ...view(inserted), created: true };
      // Thua cuộc đua cùng khoá: trả dòng đã được tạo.
      const [again] = await db
        .select()
        .from(actionLedger)
        .where(
          and(
            eq(actionLedger.workspaceId, input.workspaceId),
            eq(actionLedger.idempotencyKey, input.idempotencyKey),
          ),
        );
      return { ...view(again!), created: false };
    },

    /**
     * Nhận một hành động `queued` và gửi ĐÚNG MỘT LẦN (chỉ cho mã server/job). Nhận việc bằng cập nhật có điều kiện nên hai
     * tiến trình song song chỉ một thắng. Mọi kiểm tra chắc chắn-chưa-gửi chạy TRƯỚC khi gọi nhà cung cấp; lỗi sau khi
     * gọi là không chắc → `send_unknown`.
     */
    async dispatch(input: {
      actionId: string;
    }): Promise<{ status: DispatchStatus }> {
      // Cờ hệ thống tắt: giữ nguyên việc đã xếp hàng, không gửi.
      if (!live()) return { status: "deferred" };
      const [a] = await db
        .update(actionLedger)
        .set({
          state: "dispatching",
          dispatchedAt: now(),
          attempts: sql`${actionLedger.attempts} + 1`,
        })
        .where(
          and(
            eq(actionLedger.id, input.actionId),
            eq(actionLedger.state, "queued"),
          ),
        )
        .returning();
      if (!a) return { status: "skipped" };
      const open: ActionState[] = ["dispatching", "cancel_requested"];

      const blocked = async (reason: BlockReason) => {
        await finish(a.id, open, "blocked", { blockedReason: reason });
        return { status: "blocked" as const };
      };
      const failed = async (code: string) => {
        await finish(a.id, open, "failed", { errorCode: code });
        return { status: "failed" as const };
      };

      const [w] = await db
        .select({
          on: workspaces.outboundEnabled,
          max: workspaces.outboundMaxPerHour,
        })
        .from(workspaces)
        .where(eq(workspaces.id, a.workspaceId));
      if (!w) return failed("workspace_missing");
      const text = await draftText(a.draftId, a.draftVersion);
      if (text === null) return failed("draft_missing");
      // Phiên bản nháp bất biến: băm lệch nghĩa là dữ liệu bị đụng vào — không gửi thứ chưa được duyệt.
      if (textHashOf(text) !== a.textHash) return failed("draft_changed");
      if (a.conversationId === null) return failed("conversation_missing");
      const tgt = await target(a.conversationId);
      if (!tgt) return failed("conversation_missing");

      // Kiểm lại chính sách lúc gửi (cờ workspace có thể đã tắt, cửa sổ có thể đã đóng). Hạn mức đã tính lúc xếp hàng.
      const verdict = evaluateSendPolicy({
        live: live(),
        workspace: {
          outboundEnabled: w.on,
          maxPerHour: Number.MAX_SAFE_INTEGER,
        },
        platform: tgt.platform as Platform,
        lastIncomingAt: await lastIncomingAt(tgt.conversationId),
        text,
        sentLastHour: 0,
        now: now(),
      });
      if (!verdict.ok) return blocked(verdict.reason);

      let provider: SocialProvider | undefined;
      try {
        provider = resolveProvider(
          tgt.provider,
          box.decrypt(tgt.credentialsEnc),
        );
      } catch {
        return failed("credentials_unreadable");
      }
      if (!provider) return failed("provider_unavailable");

      // ---- Từ đây mọi lỗi KHÔNG CHẮC (tin có thể đã đi) trừ khi nhà cung cấp từ chối chắc chắn. ----
      try {
        const r = await sendMessage(provider, {
          platform: tgt.platform as Platform,
          accountId: tgt.accountRef,
          conversationId: tgt.conversationRef,
          text,
        });
        await finish(a.id, open, "confirmed", {
          providerMessageIds: r.messageIds,
          errorCode: null,
        });
        await markDraftSent(a.draftId);
        return { status: "sent" };
      } catch (e) {
        // Lỗi của wrapper TRƯỚC khi chạm mạng: chắc chắn chưa gửi.
        if (e instanceof ValidationError) return failed("validation");
        if (e instanceof UnsupportedError) return failed(e.code);
        if (e instanceof SendRejectedError) {
          if (e.reason === "window_closed") return blocked("window_closed");
          return failed(safeCodeOf(e));
        }
        // Hết giờ, mất kết nối, 5xx, phản hồi đọc không được, lỗi lạ: KHÔNG gửi lại.
        await finish(a.id, open, "send_unknown", { errorCode: safeCodeOf(e) });
        return { status: "send_unknown" };
      }
    },

    async get(input: {
      actorId: string;
      workspaceId: string;
      actionId: string;
    }): Promise<ActionView> {
      await requireAction(db, input.actorId, input.workspaceId, "inbox.read");
      if (!UUID.test(input.actionId)) throw new NotFoundError();
      const [row] = await db
        .select()
        .from(actionLedger)
        .where(
          and(
            eq(actionLedger.id, input.actionId),
            eq(actionLedger.workspaceId, input.workspaceId),
          ),
        );
      if (!row) throw new NotFoundError();
      return view(row);
    },

    async list(input: {
      actorId: string;
      workspaceId: string;
      state?: ActionState;
      limit?: number;
    }): Promise<ActionView[]> {
      await requireAction(db, input.actorId, input.workspaceId, "inbox.read");
      const limit = Math.min(
        Math.max(Math.trunc(input.limit ?? 50) || 1, 1),
        100,
      );
      const rows = await db
        .select()
        .from(actionLedger)
        .where(
          and(
            eq(actionLedger.workspaceId, input.workspaceId),
            input.state ? eq(actionLedger.state, input.state) : undefined,
          ),
        )
        .orderBy(desc(actionLedger.createdAt), asc(actionLedger.id))
        .limit(limit);
      return rows.map(view);
    },
  };
}

export type ActionService = ReturnType<typeof createActionService>;
