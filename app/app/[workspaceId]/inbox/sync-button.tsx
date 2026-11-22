"use client";

import { useActionState } from "react";

import { syncAccountAction, type SyncState } from "./actions";

const initial: SyncState = { message: null, error: false, runs: 0 };

export function SyncButton({
  workspaceId,
  accountId,
  name,
}: {
  workspaceId: string;
  accountId: string;
  name: string;
}) {
  const [state, action, pending] = useActionState(
    syncAccountAction.bind(null, workspaceId, accountId),
    initial,
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        aria-label={`Đồng bộ ${name}`}
        className="rounded border border-border px-3 py-1 disabled:opacity-60"
      >
        {pending ? "Đang đồng bộ…" : "Đồng bộ"}
      </button>
      <span
        role="status"
        aria-live="polite"
        className={state.error ? "text-danger" : "text-muted-foreground"}
      >
        {state.message}
      </span>
    </form>
  );
}
