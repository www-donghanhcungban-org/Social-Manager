"use server";

import { redirect } from "next/navigation";

import {
  ConflictError,
  ForbiddenError,
  TooManyAttemptsError,
} from "@/src/auth/errors";
import { getContainer, requireUser } from "@/src/server/runtime";

export interface DeleteAccountState {
  error: string | null;
}

/**
 * Xoá tài khoản của CHÍNH người đang đăng nhập (CMP-RIGHTS-007): id lấy từ phiên, không từ form; đòi nhập lại mật khẩu
 * và tích xác nhận. Thành công thì chuyển về đăng nhập (phiên đã bị xoá cùng tài khoản).
 */
export async function deleteAccountAction(
  _prev: DeleteAccountState,
  form: FormData,
): Promise<DeleteAccountState> {
  const user = await requireUser();
  if (form.get("confirm") !== "on")
    return { error: "Hãy tích ô xác nhận để xoá tài khoản." };
  try {
    await getContainer().services.accountRights.deleteAccount({
      userId: user.id,
      password: String(form.get("password") ?? ""),
    });
  } catch (e) {
    if (e instanceof TooManyAttemptsError) return { error: e.message };
    if (e instanceof ForbiddenError) return { error: "Mật khẩu không đúng." };
    if (e instanceof ConflictError) return { error: e.message };
    throw e;
  }
  redirect("/login");
}
