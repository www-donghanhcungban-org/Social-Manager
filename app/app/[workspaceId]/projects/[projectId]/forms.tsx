"use client";

import { useActionState } from "react";

import {
  addAliasAction,
  recordDecisionAction,
  removeAliasAction,
  type ProjectState,
} from "./actions";

const initial: ProjectState = { message: null, error: false, runs: 0 };

function Status({ state }: { state: ProjectState }) {
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

export function AliasForm({
  workspaceId,
  projectId,
}: {
  workspaceId: string;
  projectId: string;
}) {
  const [state, action, pending] = useActionState(
    addAliasAction.bind(null, workspaceId, projectId),
    initial,
  );
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="alias">Bí danh mới</label>
        <input
          id="alias"
          name="alias"
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
        Thêm bí danh
      </button>
      <Status state={state} />
    </form>
  );
}

export function RemoveAliasButton({
  workspaceId,
  projectId,
  aliasId,
  alias,
}: {
  workspaceId: string;
  projectId: string;
  aliasId: string;
  alias: string;
}) {
  const [state, action, pending] = useActionState(
    removeAliasAction.bind(null, workspaceId, projectId, aliasId),
    initial,
  );
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <button
        type="submit"
        disabled={pending}
        aria-label={`Bỏ bí danh ${alias}`}
        className="rounded border border-border px-2 text-sm disabled:opacity-60"
      >
        Bỏ
      </button>
      <Status state={state} />
    </form>
  );
}

export interface SourceOption {
  id: string;
  label: string;
}

export function DecisionForm({
  workspaceId,
  projectId,
  sources,
  active,
}: {
  workspaceId: string;
  projectId: string;
  sources: SourceOption[];
  active: SourceOption[];
}) {
  const [state, action, pending] = useActionState(
    recordDecisionAction.bind(null, workspaceId, projectId),
    initial,
  );
  return (
    <form action={action} className="flex flex-col gap-2">
      <label htmlFor="decision-text">Nội dung quyết định</label>
      <textarea
        id="decision-text"
        name="text"
        required
        rows={3}
        maxLength={2000}
        className="rounded border border-border p-2"
      />
      <label htmlFor="decision-source">Bằng chứng nguồn</label>
      <select
        id="decision-source"
        name="source"
        required
        className="rounded border border-border p-2"
      >
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      {active.length > 0 && (
        <>
          <label htmlFor="decision-supersedes">
            Thay quyết định (tuỳ chọn)
          </label>
          <select
            id="decision-supersedes"
            name="supersedes"
            className="rounded border border-border p-2"
          >
            <option value="">Không thay quyết định nào</option>
            {active.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded border border-border px-3 py-1 disabled:opacity-60"
        >
          Ghi quyết định
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}
