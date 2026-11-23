"use server";

import { revalidatePath } from "next/cache";

import { blockLabel, describeActionError } from "@/src/actions/labels";
import { getContainer, requireWorkspace } from "@/src/server/runtime";

export interface FormState {
  message: string | null;
  error: boolean;
  /** Đổi sau mỗi lần gửi form để thông báo được đọc lại dù nội dung giống lần trước. */
  runs: number;
}

const done = (prev: FormState, message: string, error = false): FormState => ({
  message,
  error,
  runs: prev.runs + 1,
});

const field = (f: FormData, name: string) => {
  const v = f.get(name);
  return typeof v === "string" ? v : "";
};

/** Chạy một thao tác; lỗi người dùng gặp được → lời nhắn, lỗi lạ ném lại (không in ra giao diện). */
async function run(
  workspaceId: string,
  conversationId: string,
  prev: FormState,
  fn: (ctx: {
    actorId: string;
    services: ReturnType<typeof getContainer>["services"];
  }) => Promise<string | { error: string }>,
): Promise<FormState> {
  const { user } = await requireWorkspace(workspaceId);
  try {
    const message = await fn({
      actorId: user.id,
      services: getContainer().services,
    });
    revalidatePath(`/app/${workspaceId}/conversations/${conversationId}`);
    return typeof message === "string"
      ? done(prev, message)
      : done(prev, message.error, true);
  } catch (e) {
    return done(prev, describeActionError(e), true);
  }
}

/** Lưu nháp: chưa có thì tạo, đã có thì tạo phiên bản mới (khoá lạc quan theo phiên bản người dùng đang xem). */
export async function saveDraftAction(
  workspaceId: string,
  conversationId: string,
  prev: FormState,
  formData: FormData,
) {
  return run(
    workspaceId,
    conversationId,
    prev,
    async ({ actorId, services }) => {
      const draftId = field(formData, "draftId");
      const text = field(formData, "text");
      if (draftId === "") {
        await services.drafts.create({
          actorId,
          workspaceId,
          conversationId,
          text,
        });
        return "Đã lưu nháp.";
      }
      await services.drafts.edit({
        actorId,
        workspaceId,
        draftId,
        baseVersion: Number(field(formData, "baseVersion")),
        text,
      });
      return "Đã lưu phiên bản mới của nháp.";
    },
  );
}

export async function discardDraftAction(
  workspaceId: string,
  conversationId: string,
  draftId: string,
  prev: FormState,
) {
  return run(
    workspaceId,
    conversationId,
    prev,
    async ({ actorId, services }) => {
      await services.drafts.discard({ actorId, workspaceId, draftId });
      return "Đã bỏ nháp.";
    },
  );
}

/** Yêu cầu gửi: khoá lũy đẳng đến từ form (sinh khi dựng trang) nên bấm đúp không tạo hai hành động. */
export async function requestSendAction(
  workspaceId: string,
  conversationId: string,
  draftId: string,
  prev: FormState,
  formData: FormData,
) {
  return run(
    workspaceId,
    conversationId,
    prev,
    async ({ actorId, services }) => {
      const a = await services.actions.requestSend({
        actorId,
        workspaceId,
        draftId,
        idempotencyKey: field(formData, "idempotencyKey"),
      });
      if (a.state === "blocked") return { error: blockLabel(a.blockedReason) };
      return "Đã xếp hàng gửi. Trạng thái cập nhật ở mục bên dưới.";
    },
  );
}

export async function cancelActionAction(
  workspaceId: string,
  conversationId: string,
  actionId: string,
  prev: FormState,
) {
  return run(
    workspaceId,
    conversationId,
    prev,
    async ({ actorId, services }) => {
      const a = await services.actions.cancel({
        actorId,
        workspaceId,
        actionId,
      });
      return a.state === "cancel_requested"
        ? "Đã yêu cầu huỷ; nếu tin đã đi thì không rút lại được."
        : "Đã huỷ, tin sẽ không được gửi.";
    },
  );
}

export async function resolveUnknownAction(
  workspaceId: string,
  conversationId: string,
  actionId: string,
  outcome: "sent" | "not_sent",
  prev: FormState,
) {
  return run(
    workspaceId,
    conversationId,
    prev,
    async ({ actorId, services }) => {
      await services.actions.resolveUnknown({
        actorId,
        workspaceId,
        actionId,
        outcome,
      });
      return outcome === "sent"
        ? "Đã ghi: tin đã được gửi."
        : "Đã ghi: tin chưa được gửi.";
    },
  );
}
