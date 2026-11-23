"use server";

import { revalidatePath } from "next/cache";

import { describeActionError } from "@/src/actions/labels";
import { getContainer, requireWorkspace } from "@/src/server/runtime";

export interface ProjectState {
  message: string | null;
  error: boolean;
  runs: number;
}

const field = (f: FormData, n: string) => {
  const v = f.get(n);
  return typeof v === "string" ? v : "";
};

const refresh = (workspaceId: string, projectId: string) =>
  revalidatePath(`/app/${workspaceId}/projects/${projectId}`);

export async function addAliasAction(
  workspaceId: string,
  projectId: string,
  prev: ProjectState,
  formData: FormData,
): Promise<ProjectState> {
  const { user } = await requireWorkspace(workspaceId);
  const runs = prev.runs + 1;
  try {
    await getContainer().services.knowledge.addAlias({
      actorId: user.id,
      workspaceId,
      projectId,
      alias: field(formData, "alias"),
    });
    refresh(workspaceId, projectId);
    return { message: "Đã thêm bí danh.", error: false, runs };
  } catch (e) {
    return { message: describeActionError(e), error: true, runs };
  }
}

export async function removeAliasAction(
  workspaceId: string,
  projectId: string,
  aliasId: string,
  prev: ProjectState,
): Promise<ProjectState> {
  const { user } = await requireWorkspace(workspaceId);
  const runs = prev.runs + 1;
  try {
    await getContainer().services.knowledge.removeAlias({
      actorId: user.id,
      workspaceId,
      aliasId,
    });
    refresh(workspaceId, projectId);
    return { message: "Đã bỏ bí danh.", error: false, runs };
  } catch (e) {
    return { message: describeActionError(e), error: true, runs };
  }
}

/** Ghi quyết định: bắt buộc chọn bằng chứng nguồn; có thể thay một quyết định đang hiệu lực. */
export async function recordDecisionAction(
  workspaceId: string,
  projectId: string,
  prev: ProjectState,
  formData: FormData,
): Promise<ProjectState> {
  const { user } = await requireWorkspace(workspaceId);
  const runs = prev.runs + 1;
  try {
    const supersedes = field(formData, "supersedes");
    await getContainer().services.knowledge.recordDecision({
      actorId: user.id,
      workspaceId,
      projectId,
      text: field(formData, "text"),
      sourceEvidenceItemId: field(formData, "source"),
      ...(supersedes !== "" ? { supersedesId: supersedes } : {}),
    });
    refresh(workspaceId, projectId);
    return { message: "Đã ghi quyết định.", error: false, runs };
  } catch (e) {
    return { message: describeActionError(e), error: true, runs };
  }
}
