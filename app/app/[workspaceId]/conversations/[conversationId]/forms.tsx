"use client";

import { useActionState } from "react";

import {
  cancelActionAction,
  discardDraftAction,
  requestSendAction,
  resolveUnknownAction,
  saveDraftAction,
  type FormState,
} from "../actions";

const initial: FormState = { message: null, error: false, runs: 0 };

function Status({ state }: { state: FormState }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={state.error ? "text-danger" : "text-muted-foreground"}
    >
      {state.message}
    </span>
  );
}

const btn = "rounded border border-border px-3 py-1 disabled:opacity-60";

/** Soạn hoặc sửa nháp. `draft` có sẵn thì lưu thành phiên bản mới (khoá lạc quan theo `currentVersion` đang xem). */
export function DraftEditor({
  workspaceId,
  conversationId,
  draft,
}: {
  workspaceId: string;
  conversationId: string;
  draft: { id: string; currentVersion: number; text: string } | null;
}) {
  const [state, action, pending] = useActionState(
    saveDraftAction.bind(null, workspaceId, conversationId),
    initial,
  );
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="draftId" value={draft?.id ?? ""} />
      <input
        type="hidden"
        name="baseVersion"
        value={draft?.currentVersion ?? 0}
      />
      <label htmlFor="draft-text" className="font-medium">
        {draft ? `Nháp (phiên bản ${draft.currentVersion})` : "Soạn trả lời"}
      </label>
      <textarea
        id="draft-text"
        name="text"
        required
        maxLength={4000}
        rows={4}
        defaultValue={draft?.text ?? ""}
        className="rounded border border-border p-2"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={btn}>
          {pending ? "Đang lưu…" : "Lưu nháp"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

/** Gửi nháp: `idempotencyKey` sinh ở máy chủ khi dựng trang, nên bấm đúp cùng một trang không tạo hai hành động. */
export function SendButton({
  workspaceId,
  conversationId,
  draftId,
  idempotencyKey,
}: {
  workspaceId: string;
  conversationId: string;
  draftId: string;
  idempotencyKey: string;
}) {
  const [state, action, pending] = useActionState(
    requestSendAction.bind(null, workspaceId, conversationId, draftId),
    initial,
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <button type="submit" disabled={pending} className={btn}>
        {pending ? "Đang yêu cầu…" : "Yêu cầu gửi"}
      </button>
      <Status state={state} />
    </form>
  );
}

export function DiscardButton({
  workspaceId,
  conversationId,
  draftId,
}: {
  workspaceId: string;
  conversationId: string;
  draftId: string;
}) {
  const [state, action, pending] = useActionState(
    discardDraftAction.bind(null, workspaceId, conversationId, draftId),
    initial,
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <button type="submit" disabled={pending} className={btn}>
        Bỏ nháp
      </button>
      <Status state={state} />
    </form>
  );
}

export function CancelButton({
  workspaceId,
  conversationId,
  actionId,
}: {
  workspaceId: string;
  conversationId: string;
  actionId: string;
}) {
  const [state, action, pending] = useActionState(
    cancelActionAction.bind(null, workspaceId, conversationId, actionId),
    initial,
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <button type="submit" disabled={pending} className={btn}>
        Huỷ gửi
      </button>
      <Status state={state} />
    </form>
  );
}

/** Quyết định thủ công cho `send_unknown` (admin/owner): chỉ ghi nhận, KHÔNG gửi lại. */
export function ResolveButtons({
  workspaceId,
  conversationId,
  actionId,
}: {
  workspaceId: string;
  conversationId: string;
  actionId: string;
}) {
  const [s1, a1, p1] = useActionState(
    resolveUnknownAction.bind(
      null,
      workspaceId,
      conversationId,
      actionId,
      "sent",
    ),
    initial,
  );
  const [s2, a2, p2] = useActionState(
    resolveUnknownAction.bind(
      null,
      workspaceId,
      conversationId,
      actionId,
      "not_sent",
    ),
    initial,
  );
  return (
    <div className="flex flex-wrap items-center gap-3">
      <form action={a1}>
        <button type="submit" disabled={p1 || p2} className={btn}>
          Tin đã được gửi
        </button>
      </form>
      <form action={a2}>
        <button type="submit" disabled={p1 || p2} className={btn}>
          Tin chưa được gửi
        </button>
      </form>
      <Status state={s1.runs >= s2.runs ? s1 : s2} />
    </div>
  );
}
