"use server";

import { revalidatePath } from "next/cache";

import { ForbiddenError, NotFoundError } from "@/src/auth/errors";
import { ValidationError } from "@/src/providers/types";
import { getContainer, requireWorkspace } from "@/src/server/runtime";

export interface RetentionFormState {
  error: string | null;
  saved: boolean;
}

export interface AiConsentFormState {
  error: string | null;
  saved: boolean;
}

/**
 * Owner cấp hoặc rút đồng ý gửi dữ liệu tới AI đám mây (CMP-RIGHTS-004: cùng một biểu mẫu, một bước cho cả hai chiều).
 * `enabled` là ý định của nút bấm; quyền và bản ghi đồng ý do dịch vụ xử lý.
 */
export async function setAiCloudAction(
  workspaceId: string,
  _prev: AiConsentFormState,
  form: FormData,
): Promise<AiConsentFormState> {
  const { user } = await requireWorkspace(workspaceId);
  try {
    await getContainer().services.workspaces.setAiCloud({
      actorId: user.id,
      workspaceId,
      enabled: form.get("enabled") === "true",
    });
  } catch (e) {
    if (e instanceof ForbiddenError)
      return {
        error: "Chỉ chủ workspace đổi được cài đặt này.",
        saved: false,
      };
    if (e instanceof NotFoundError)
      return { error: "Không tìm thấy workspace.", saved: false };
    throw e;
  }
  revalidatePath(`/app/${workspaceId}`);
  return { error: null, saved: true };
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
