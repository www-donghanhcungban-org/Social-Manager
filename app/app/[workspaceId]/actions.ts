"use server";

import { revalidatePath } from "next/cache";

import { ForbiddenError, NotFoundError } from "@/src/auth/errors";
import { ValidationError } from "@/src/providers/types";
import { getContainer, requireWorkspace } from "@/src/server/runtime";

export interface RetentionFormState {
  error: string | null;
  saved: boolean;
}

/** Owner đặt thời hạn lưu tin (D-010). Quyền kiểm ở dịch vụ, không tin form. */
export async function setRetentionAction(
  workspaceId: string,
  _prev: RetentionFormState,
  form: FormData,
): Promise<RetentionFormState> {
  const { user } = await requireWorkspace(workspaceId);
  const raw = String(form.get("days") ?? "").trim();
  const days = raw === "" ? null : Number(raw);
  try {
    await getContainer().services.workspaces.setRetention({
      actorId: user.id,
      workspaceId,
      days,
      forever: form.get("forever") === "on",
    });
  } catch (e) {
    if (e instanceof ValidationError) return { error: e.message, saved: false };
    if (e instanceof ForbiddenError)
      return {
        error: "Chỉ chủ workspace đổi được thời hạn lưu.",
        saved: false,
      };
    if (e instanceof NotFoundError)
      return { error: "Không tìm thấy workspace.", saved: false };
    throw e;
  }
  revalidatePath(`/app/${workspaceId}`);
  return { error: null, saved: true };
}
