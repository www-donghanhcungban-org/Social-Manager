"use server";

import { revalidatePath } from "next/cache";

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/src/auth/errors";
import { ValidationError } from "@/src/providers/types";
import { getContainer, requireWorkspace } from "@/src/server/runtime";

export interface ActionState {
  error: string | null;
  ok?: boolean;
}

/** Lỗi nghiệp vụ đã biết → thông điệp cho người dùng; lỗi khác để biên lỗi của trang xử lý. */
function toState(e: unknown): ActionState {
  if (e instanceof ValidationError || e instanceof ConflictError)
    return { error: e.message };
  if (e instanceof ForbiddenError)
    return { error: "Bạn không có quyền thực hiện thao tác này." };
  if (e instanceof NotFoundError)
    return { error: "Không tìm thấy mục này (có thể đã bị xoá)." };
  throw e;
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function addConnectionAction(
  workspaceId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { user } = await requireWorkspace(workspaceId);
  try {
    await getContainer().services.connections.create({
      actorId: user.id,
      workspaceId,
      provider: str(form, "provider"),
      label: str(form, "label"),
      credentials: str(form, "credentials"),
    });
  } catch (e) {
    return toState(e);
  }
  revalidatePath(`/app/${workspaceId}/connections`);
  return { error: null, ok: true };
}

export async function addAccountAction(
  workspaceId: string,
  connectionId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { user } = await requireWorkspace(workspaceId);
  try {
    await getContainer().services.accounts.add({
      actorId: user.id,
      workspaceId,
      connectionId,
      platform: str(form, "platform"),
      externalId: str(form, "externalId"),
      displayName: str(form, "displayName"),
    });
  } catch (e) {
    return toState(e);
  }
  revalidatePath(`/app/${workspaceId}/connections`);
  return { error: null, ok: true };
}

export async function removeConnectionAction(
  workspaceId: string,
  connectionId: string,
): Promise<void> {
  const { user } = await requireWorkspace(workspaceId);
  await getContainer()
    .services.connections.remove({
      actorId: user.id,
      workspaceId,
      connectionId,
    })
    .catch((e: unknown) => {
      // Đã xoá rồi thì coi như xong (idempotent); lỗi khác ném tiếp.
      if (!(e instanceof NotFoundError)) throw e;
    });
  revalidatePath(`/app/${workspaceId}/connections`);
}

export async function removeAccountAction(
  workspaceId: string,
  accountId: string,
): Promise<void> {
  const { user } = await requireWorkspace(workspaceId);
  await getContainer()
    .services.accounts.remove({ actorId: user.id, workspaceId, accountId })
    .catch((e: unknown) => {
      if (!(e instanceof NotFoundError)) throw e;
    });
  revalidatePath(`/app/${workspaceId}/connections`);
}
