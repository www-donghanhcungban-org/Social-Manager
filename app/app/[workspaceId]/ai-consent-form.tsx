"use client";

import { useActionState } from "react";

import { setAiCloudAction, type AiConsentFormState } from "./actions";

const initial: AiConsentFormState = { error: null, saved: false };

/** Một nút cho cả hai chiều: cấp và rút đồng ý cùng chỗ, cùng số bước (CMP-RIGHTS-004). */
export function AiConsentForm({
  workspaceId,
  enabled,
}: {
  workspaceId: string;
  enabled: boolean;
}) {
  const [state, action, pending] = useActionState(
    setAiCloudAction.bind(null, workspaceId),
    initial,
  );
  return (
    <form action={action} className="flex max-w-xl flex-col gap-3">
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
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
        {pending
          ? "Đang lưu…"
          : enabled
            ? "Rút đồng ý"
            : "Đồng ý và bật AI đám mây"}
      </button>
    </form>
  );
}
