"use server";

import { revalidatePath } from "next/cache";

import { describeActionError } from "@/src/actions/labels";
import { getContainer, requireWorkspace } from "@/src/server/runtime";

export interface DocState {
  message: string | null;
  error: boolean;
  runs: number;
}

const field = (f: FormData, n: string) => {
  const v = f.get(n);
  return typeof v === "string" ? v : "";
};

/** Nhập một tài liệu văn bản: lũy đẳng theo (tiêu đề, nội dung); cùng tiêu đề khác nội dung là phiên bản mới. */
export async function importDocumentAction(
  workspaceId: string,
  prev: DocState,
  formData: FormData,
): Promise<DocState> {
  const { user } = await requireWorkspace(workspaceId);
  const runs = prev.runs + 1;
  const title = field(formData, "title").normalize("NFC").trim();
  try {
    if (title === "" || title.length > 200) {
      return { message: "Tiêu đề phải dài 1-200 ký tự.", error: true, runs };
    }
    const r = await getContainer().services.evidence.ingest({
      actorId: user.id,
      workspaceId,
      source: "document",
      externalId: title,
      content: field(formData, "content"),
      contentType: "text/plain",
      observedAt: new Date(),
    });
    revalidatePath(`/app/${workspaceId}/documents`);
    return {
      message: r.duplicate
        ? "Tài liệu này đã có (cùng tiêu đề và nội dung), không thêm lần nữa."
        : "Đã nhập tài liệu. Tìm được ở mục Tìm kiếm.",
      error: false,
      runs,
    };
  } catch (e) {
    return { message: describeActionError(e), error: true, runs };
  }
}

export async function createProjectAction(
  workspaceId: string,
  prev: DocState,
  formData: FormData,
): Promise<DocState> {
  const { user } = await requireWorkspace(workspaceId);
  const runs = prev.runs + 1;
  try {
    await getContainer().services.knowledge.createProject({
      actorId: user.id,
      workspaceId,
      name: field(formData, "name"),
    });
    revalidatePath(`/app/${workspaceId}/documents`);
    return { message: "Đã tạo dự án.", error: false, runs };
  } catch (e) {
    return { message: describeActionError(e), error: true, runs };
  }
}

export async function addAliasAction(
  workspaceId: string,
  projectId: string,
  prev: DocState,
  formData: FormData,
): Promise<DocState> {
  const { user } = await requireWorkspace(workspaceId);
  const runs = prev.runs + 1;
  try {
    await getContainer().services.knowledge.addAlias({
      actorId: user.id,
      workspaceId,
      projectId,
      alias: field(formData, "alias"),
    });
    revalidatePath(`/app/${workspaceId}/documents`);
    return { message: "Đã thêm bí danh.", error: false, runs };
  } catch (e) {
    return { message: describeActionError(e), error: true, runs };
  }
}

export async function removeAliasAction(
  workspaceId: string,
  aliasId: string,
  prev: DocState,
): Promise<DocState> {
  const { user } = await requireWorkspace(workspaceId);
  const runs = prev.runs + 1;
  try {
    await getContainer().services.knowledge.removeAlias({
      actorId: user.id,
      workspaceId,
      aliasId,
    });
    revalidatePath(`/app/${workspaceId}/documents`);
    return { message: "Đã xoá bí danh.", error: false, runs };
  } catch (e) {
    return { message: describeActionError(e), error: true, runs };
  }
}
