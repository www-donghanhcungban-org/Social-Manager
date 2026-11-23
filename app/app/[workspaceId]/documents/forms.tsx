"use client";

import { useActionState } from "react";

import {
  createProjectAction,
  importDocumentAction,
  type DocState,
} from "./actions";

const initial: DocState = { message: null, error: false, runs: 0 };

function Status({ state }: { state: DocState }) {
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

export function ImportForm({ workspaceId }: { workspaceId: string }) {
  const [state, action, pending] = useActionState(
    importDocumentAction.bind(null, workspaceId),
    initial,
  );
  return (
    <form action={action} className="flex flex-col gap-2">
      <label htmlFor="doc-title">Tiêu đề</label>
      <input
        id="doc-title"
        name="title"
        required
        maxLength={200}
        className="rounded border border-border p-2"
      />
      <label htmlFor="doc-content">Nội dung</label>
      <textarea
        id="doc-content"
        name="content"
        required
        rows={8}
        className="rounded border border-border p-2"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded border border-border px-3 py-1 disabled:opacity-60"
        >
          {pending ? "Đang nhập…" : "Nhập tài liệu"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function ProjectForm({ workspaceId }: { workspaceId: string }) {
  const [state, action, pending] = useActionState(
    createProjectAction.bind(null, workspaceId),
    initial,
  );
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="project-name">Tên dự án</label>
        <input
          id="project-name"
          name="name"
          required
          maxLength={100}
          className="rounded border border-border p-2"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-border px-3 py-1 disabled:opacity-60"
      >
        Tạo dự án
      </button>
      <Status state={state} />
    </form>
  );
}
