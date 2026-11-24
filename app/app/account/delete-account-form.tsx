"use client";

import { useActionState } from "react";

import { deleteAccountAction, type DeleteAccountState } from "./actions";

const initial: DeleteAccountState = { error: null };
const field = "mt-1 w-72 rounded border border-border bg-background px-3 py-2";

export function DeleteAccountForm() {
  const [state, action, pending] = useActionState(deleteAccountAction, initial);
  return (
    <form action={action} className="flex max-w-xl flex-col gap-3">
      <label className="block">
        Nhập lại mật khẩu để xác nhận
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={field}
        />
      </label>
      <label className="flex items-start gap-2">
        <input name="confirm" type="checkbox" className="mt-1" />
        <span>
          Tôi hiểu việc xoá không hoàn tác được: workspace chỉ có mình tôi bị
          xoá cùng toàn bộ dữ liệu trong đó.
        </span>
      </label>
      <p
        role="alert"
        aria-live="polite"
        className={state.error ? "min-h-6 text-danger" : "min-h-6"}
      >
        {state.error}
      </p>
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded border border-danger px-4 py-2 font-medium text-danger disabled:opacity-60"
      >
        {pending ? "Đang xoá…" : "Xoá tài khoản"}
      </button>
    </form>
  );
}
