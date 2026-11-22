"use server";

import { revalidatePath } from "next/cache";

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/src/auth/errors";
import { ValidationError } from "@/src/providers/types";
import { getContainer, requireWorkspace } from "@/src/server/runtime";

export interface PostFormState {
  error: string | null;
  /** Tăng sau mỗi lần đăng thành công: form dùng để đổi khoá idempotency và xoá nội dung. */
  created: number;
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function createPostAction(
  workspaceId: string,
  prev: PostFormState,
  form: FormData,
): Promise<PostFormState> {
  const { user } = await requireWorkspace(workspaceId);
  const scheduledAt = str(form, "scheduledAt").trim();
  try {
    await getContainer().services.posts.schedule({
      actorId: user.id,
      workspaceId,
      accountId: str(form, "accountId"),
      text: str(form, "text"),
      scheduledAt: scheduledAt === "" ? undefined : scheduledAt,
      idempotencyKey: str(form, "idempotencyKey"),
    });
  } catch (e) {
    if (e instanceof ValidationError || e instanceof ConflictError)
      return { ...prev, error: e.message };
    if (e instanceof ForbiddenError)
      return { ...prev, error: "Bạn không có quyền đăng bài." };
    if (e instanceof NotFoundError)
      return { ...prev, error: "Không tìm thấy tài khoản đã chọn." };
    throw e;
  }
  revalidatePath(`/app/${workspaceId}/posts`);
  return { error: null, created: prev.created + 1 };
}
