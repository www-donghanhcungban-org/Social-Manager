import { headers } from "next/headers";
import { redirect } from "next/navigation";

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

/** Dùng ở trang/action cần đăng nhập: chưa đăng nhập thì chuyển tới /login. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}
