"use client";

import { useActionState, useRef } from "react";

import { createPostAction, type PostFormState } from "./actions";

const initial: PostFormState = { error: null, created: 0 };
const field =
  "mt-1 w-full rounded border border-border bg-background px-3 py-2";

type Account = { id: string; name: string; platform: string };

/** `datetime-local` không có múi giờ: đổi sang ISO UTC theo múi giờ của trình duyệt trước khi gửi. */
function toIso(local: string): string {
  if (local === "") return "";
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? local : d.toISOString();
}

export function PostForm({
  workspaceId,
  accounts,
}: {
  workspaceId: string;
  accounts: Account[];
}) {
  const [state, action, pending] = useActionState(
    createPostAction.bind(null, workspaceId),
    initial,
  );
  // `key` đổi sau mỗi bài thành công: form dựng lại (xoá nội dung) và có khoá idempotency mới.
  return (
    <PostFields
      key={state.created}
      state={state}
      action={action}
      pending={pending}
      accounts={accounts}
    />
  );
}

function PostFields({
  state,
  action,
  pending,
  accounts,
}: {
  state: PostFormState;
  action: (fd: FormData) => void;
  pending: boolean;
  accounts: Account[];
}) {
  // Khoá được tạo lúc gửi lần đầu rồi giữ nguyên: bấm gửi lại do mạng chậm không đăng đôi bài.
  const keyRef = useRef<string | null>(null);
  return (
    <form
      action={(fd) => {
        keyRef.current ??= crypto.randomUUID();
        fd.set("idempotencyKey", keyRef.current);
        fd.set("scheduledAt", toIso(String(fd.get("scheduledAtLocal") ?? "")));
        fd.delete("scheduledAtLocal");
        action(fd);
      }}
      className="flex max-w-xl flex-col gap-3"
    >
      <label className="block">
        Tài khoản
        <select name="accountId" required className={field}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.platform})
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        Nội dung
        <textarea name="text" required rows={5} className={field} />
      </label>
      <label className="block">
        Hẹn giờ (bỏ trống để đăng ngay)
        <input
          name="scheduledAtLocal"
          type="datetime-local"
          className={field}
        />
        <span className="mt-1 block text-sm text-muted-foreground">
          Theo múi giờ của trình duyệt bạn.
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
        className="self-start rounded bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-60"
      >
        {pending ? "Đang lưu…" : "Đăng / hẹn giờ"}
      </button>
    </form>
  );
}
