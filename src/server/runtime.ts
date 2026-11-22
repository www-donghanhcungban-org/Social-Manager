import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { UUID } from "../auth/access";

import { loadEnv, processEnv } from "../config/env";
import { getAuth } from "../auth/server";
import { createContainer, type Container } from "./container";

let container: Container | undefined;

/** Một container dùng chung trong tiến trình; dựng lúc có request đầu tiên, không phải lúc import. */
export function getContainer(): Container {
  container ??= createContainer(loadEnv(processEnv()));
  return container;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

/** Người dùng hiện tại, hoặc `null` nếu chưa đăng nhập. */
export async function currentUser(): Promise<SessionUser | null> {
  // `headers()` trước: đánh dấu trang là động để lúc build không dựng auth (build không có bí mật).
  const h = await headers();
  const session = await getAuth().api.getSession({ headers: h });
  if (!session) return null;
  const { id, email, name } = session.user;
  return { id, email, name };
}

/**
 * Trang/action trong một workspace: cần đăng nhập VÀ là thành viên. Không phải thành viên, id không
 * phải UUID hay workspace không tồn tại đều cho cùng một kết quả (notFound) để không lộ workspace có thật.
 */
export async function requireWorkspace(workspaceId: string) {
  const user = await requireUser();
  if (!UUID.test(workspaceId)) notFound();
  const mine = await getContainer().services.workspaces.listForUser(user.id);
  const workspace = mine.find((w) => w.id === workspaceId);
  if (!workspace) notFound();
  return { user, workspace };
}

/** Dùng ở trang/action cần đăng nhập: chưa đăng nhập thì chuyển tới /login. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}
