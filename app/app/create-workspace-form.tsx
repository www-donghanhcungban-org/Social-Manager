"use client";

import { useActionState } from "react";

import { createWorkspaceAction, type FormState } from "./actions";

const initial: FormState = { error: null };

export function CreateWorkspaceForm() {
  const [state, action, pending] = useActionState(
    createWorkspaceAction,
    initial,
  );
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="block">
        Tên workspace (ví dụ: tên cửa hàng hoặc thương hiệu)
        <input
          name="name"
          required
          maxLength={100}
          className="mt-1 w-full rounded border border-border bg-background px-3 py-2"
          {...(state.error
            ? { "aria-invalid": true, "aria-describedby": "workspace-error" }
            : {})}
        />
      </label>
      <p
        id="workspace-error"
        role="alert"
        aria-live="polite"
        className="min-h-6 text-danger"
      >
        {state.error}
      </p>
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-60"
      >
        {pending ? "Đang tạo…" : "Tạo workspace"}
      </button>
    </form>
  );
}
