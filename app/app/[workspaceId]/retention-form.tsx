"use client";

import { useActionState } from "react";

import { setRetentionAction, type RetentionFormState } from "./actions";

const initial: RetentionFormState = { error: null, saved: false };
const field = "mt-1 w-40 rounded border border-border bg-background px-3 py-2";

export function RetentionForm({
  workspaceId,
  days,
  forever,
}: {
  workspaceId: string;
  days: number | null;
  forever: boolean;
}) {
  const [state, action, pending] = useActionState(
    setRetentionAction.bind(null, workspaceId),
    initial,
  );
  return (
    <form action={action} className="flex max-w-xl flex-col gap-3">
      <label className="block">
        Số ngày lưu tin (1–36500; bỏ trống = 365)
        <input
          name="days"
          type="number"
          inputMode="numeric"
          min={1}
          max={36500}
          step={1}
          defaultValue={days ?? ""}
          className={field}
        />
      </label>
      <label className="flex items-start gap-2">
        <input
          name="forever"
          type="checkbox"
          defaultChecked={forever}
          className="mt-1"
        />
        <span>
          Giữ vô thời hạn. Chỉ bật khi có căn cứ pháp lý và đã thông báo cho
          người nhắn tin (Luật Bảo vệ dữ liệu cá nhân).
        </span>
      </label>
      <p
        role="alert"
        aria-live="polite"
        className={state.error ? "min-h-6 text-danger" : "min-h-6"}
      >
        {state.error ?? (state.saved ? "Đã lưu." : null)}
      </p>
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-60"
      >
        {pending ? "Đang lưu…" : "Lưu thời hạn"}
      </button>
    </form>
  );
}
