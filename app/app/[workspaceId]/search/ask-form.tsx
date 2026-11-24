"use client";

import { useActionState } from "react";

import { askAction, type AskState } from "./actions";
import { AnswerView } from "./answer-view";

const initial: AskState = {
  answer: null,
  message: null,
  error: false,
  citations: [],
  runs: 0,
};

export function AskForm({ workspaceId }: { workspaceId: string }) {
  const [state, action, pending] = useActionState(
    askAction.bind(null, workspaceId),
    initial,
  );
  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-col gap-2">
        <label htmlFor="ask-q" className="font-medium">
          Câu hỏi
        </label>
        <textarea
          id="ask-q"
          name="question"
          required
          maxLength={1000}
          rows={3}
          className="rounded border border-border p-2"
        />
        <div>
          <button
            type="submit"
            disabled={pending}
            className="rounded border border-border px-3 py-1 disabled:opacity-60"
          >
            {pending ? "Đang hỏi…" : "Hỏi"}
          </button>
        </div>
      </form>
      <div role="status" aria-live="polite">
        {state.message && (
          <p className={state.error ? "text-danger" : "text-muted-foreground"}>
            {state.message}
          </p>
        )}
        {state.answer !== null && (
          <AnswerView answer={state.answer} citations={state.citations} />
        )}
      </div>
    </div>
  );
}
