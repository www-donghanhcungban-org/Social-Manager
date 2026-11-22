"use server";

import { redirect } from "next/navigation";

import { ConflictError } from "@/src/auth/errors";
import { ValidationError } from "@/src/providers/types";
import { getContainer, requireUser } from "@/src/server/runtime";

export interface FormState {
  error: string | null;
}

export async function createWorkspaceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  let id: string;
  try {
    const ws = await getContainer().services.workspaces.create({
      actorId: user.id,
      name: String(formData.get("name") ?? ""),
    });
    id = ws.id;
  } catch (e) {
    // Chỉ lỗi nghiệp vụ đã biết mới hiện thông điệp; lỗi khác để biên lỗi của trang xử lý.
    if (e instanceof ValidationError || e instanceof ConflictError)
      return { error: e.message };
    throw e;
  }
  redirect(`/app/${id}`);
}
