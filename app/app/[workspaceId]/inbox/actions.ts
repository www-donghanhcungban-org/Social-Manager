"use server";

import { revalidatePath } from "next/cache";

import { ForbiddenError, NotFoundError } from "@/src/auth/errors";
import { INBOX_STATUSES, type InboxStatus } from "@/src/db/schema";
import { ValidationError } from "@/src/providers/types";
import { getContainer, requireWorkspace } from "@/src/server/runtime";

export interface SyncState {
  message: string | null;
  error: boolean;
  /** Số lần đã bấm; đổi sau mỗi lần để thông báo được đọc lại dù nội dung giống lần trước. */
  runs: number;
}

function describe(e: unknown): string {
  if (e instanceof ForbiddenError)
    return "Bạn không có quyền thực hiện thao tác này.";
  if (e instanceof NotFoundError) return "Không tìm thấy mục này.";
  if (e instanceof ValidationError) return e.message;
  throw e;
}

export async function syncAccountAction(
  workspaceId: string,
  accountId: string,
  prev: SyncState,
): Promise<SyncState> {
  const { user } = await requireWorkspace(workspaceId);
  const runs = prev.runs + 1;
  try {
    const r = await getContainer().services.inbox.sync({
      actorId: user.id,
      workspaceId,
      accountId,
    });
    revalidatePath(`/app/${workspaceId}/inbox`);
    const parts = [`Đã nhập ${r.inserted} tin mới`];
    if (r.skipped.length > 0)
      parts.push(`chưa hỗ trợ: ${r.skipped.join(", ")}`);
    if (r.failed.length > 0)
      parts.push(`lỗi: ${r.failed.map((f) => f.kind).join(", ")}`);
    if (r.rejected > 0) parts.push(`bỏ qua ${r.rejected} mục sai`);
    return { message: parts.join("; "), error: r.failed.length > 0, runs };
  } catch (e) {
    return { message: describe(e), error: true, runs };
  }
}

export async function setStatusAction(
  workspaceId: string,
  itemId: string,
  status: string,
): Promise<void> {
  const { user } = await requireWorkspace(workspaceId);
  if (!(INBOX_STATUSES as readonly string[]).includes(status)) return;
  await getContainer()
    .services.inbox.setStatus({
      actorId: user.id,
      workspaceId,
      itemId,
      status: status as InboxStatus,
    })
    .catch((e: unknown) => {
      if (!(e instanceof NotFoundError)) throw e;
    });
  revalidatePath(`/app/${workspaceId}/inbox`);
}
