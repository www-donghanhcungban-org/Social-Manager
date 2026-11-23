"use server";

import type { Citation } from "@/src/ai/answer";
import { UNANSWERED_LABEL, describeAskError } from "@/src/ai/labels";
import { getContainer, requireWorkspace } from "@/src/server/runtime";

export interface AskState {
  /** Câu trả lời (khi trả lời được) hoặc lý do không trả lời / lỗi. */
  answer: string | null;
  message: string | null;
  error: boolean;
  citations: Citation[];
  runs: number;
}

export async function askAction(
  workspaceId: string,
  prev: AskState,
  formData: FormData,
): Promise<AskState> {
  const { user } = await requireWorkspace(workspaceId);
  const q = formData.get("question");
  const runs = prev.runs + 1;
  try {
    const r = await getContainer().services.answers.ask({
      actorId: user.id,
      workspaceId,
      question: typeof q === "string" ? q : "",
    });
    return r.answered
      ? {
          answer: r.answer,
          message: null,
          error: false,
          citations: r.citations,
          runs,
        }
      : {
          answer: null,
          message: UNANSWERED_LABEL[r.reason],
          error: false,
          citations: [],
          runs,
        };
  } catch (e) {
    return {
      answer: null,
      message: describeAskError(e),
      error: true,
      citations: [],
      runs,
    };
  }
}
