"use client";

import { useActionState } from "react";

import {
  addAccountAction,
  addConnectionAction,
  setWebhookSecretAction,
  type ActionState,
} from "./actions";

const initial: ActionState = { error: null };
const field =
  "mt-1 w-full rounded border border-border bg-background px-3 py-2";
const submit =
  "self-start rounded bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-60";

function Status({ state }: { state: ActionState }) {
  return (
    <p
      role="alert"
      aria-live="polite"
      className={state.error ? "min-h-6 text-danger" : "min-h-6"}
    >
      {state.error ?? (state.ok ? "Đã lưu." : "")}
    </p>
  );
}

export function AddConnectionForm({
  workspaceId,
  providers,
}: {
  workspaceId: string;
  providers: { id: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(
    addConnectionAction.bind(null, workspaceId),
    initial,
  );
  return (
    <form action={action} className="flex max-w-md flex-col gap-3">
      <label className="block">
        Nguồn dữ liệu
        <select name="provider" required className={field}>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        Nhãn (để phân biệt các kết nối)
        <input name="label" required maxLength={200} className={field} />
      </label>
      <label className="block">
        Khoá API
        <input
          name="credentials"
          type="password"
          required
          autoComplete="off"
          className={field}
        />
        <span className="mt-1 block text-sm text-muted-foreground">
          Được mã hoá khi lưu và không hiển thị lại. Với chế độ demo nhập bất kỳ
          giá trị nào.
        </span>
      </label>
      <Status state={state} />
      <button type="submit" disabled={pending} className={submit}>
        {pending ? "Đang lưu…" : "Thêm kết nối"}
      </button>
    </form>
  );
}

export function WebhookSecretForm({
  workspaceId,
  connectionId,
}: {
  workspaceId: string;
  connectionId: string;
}) {
  const [state, action, pending] = useActionState(
    setWebhookSecretAction.bind(null, workspaceId, connectionId),
    initial,
  );
  return (
    <form action={action} className="flex max-w-md flex-col gap-3">
      <label className="block">
        Secret webhook
        <input
          name="secret"
          type="password"
          required
          minLength={16}
          maxLength={256}
          autoComplete="off"
          className={field}
        />
        <span className="mt-1 block text-sm text-muted-foreground">
          Dán secret mà SocialAPI hiển thị một lần khi tạo endpoint. Được mã hoá
          khi lưu và không hiển thị lại.
        </span>
      </label>
      <Status state={state} />
      <button type="submit" disabled={pending} className={submit}>
        {pending ? "Đang lưu…" : "Lưu secret"}
      </button>
    </form>
  );
}

export function AddAccountForm({
  workspaceId,
  connectionId,
  platforms,
}: {
  workspaceId: string;
  connectionId: string;
  platforms: string[];
}) {
  const [state, action, pending] = useActionState(
    addAccountAction.bind(null, workspaceId, connectionId),
    initial,
  );
  return (
    <form action={action} className="flex max-w-md flex-col gap-3">
      <label className="block">
        Nền tảng
        <select name="platform" required className={field}>
          {platforms.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        Mã tài khoản (id bên nhà cung cấp)
        <input name="externalId" required maxLength={200} className={field} />
      </label>
      <label className="block">
        Tên hiển thị
        <input name="displayName" required maxLength={200} className={field} />
      </label>
      <Status state={state} />
      <button type="submit" disabled={pending} className={submit}>
        {pending ? "Đang lưu…" : "Thêm tài khoản"}
      </button>
    </form>
  );
}
