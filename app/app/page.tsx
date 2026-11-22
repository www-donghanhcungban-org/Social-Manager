import Link from "next/link";

import { getContainer, requireUser } from "@/src/server/runtime";

import { CreateWorkspaceForm } from "./create-workspace-form";

export const metadata = { title: "Workspace — Social Manager" };

export default async function AppHome() {
  const user = await requireUser();
  const workspaces = await getContainer().services.workspaces.listForUser(
    user.id,
  );
  return (
    <main className="flex flex-col gap-8">
      <section aria-labelledby="ws-list">
        <h1 id="ws-list" className="text-xl font-semibold">
          Workspace của bạn
        </h1>
        {workspaces.length === 0 ? (
          <p className="mt-2 text-muted-foreground">
            Bạn chưa có workspace nào. Tạo workspace đầu tiên để bắt đầu.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {workspaces.map((w) => (
              <li key={w.id}>
                <Link
                  href={`/app/${w.id}`}
                  className="flex items-center justify-between rounded border border-border p-3 hover:bg-muted"
                >
                  <span className="font-medium">{w.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {w.role}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="ws-new">
        <h2 id="ws-new" className="text-lg font-medium">
          Tạo workspace mới
        </h2>
        <div className="mt-3 max-w-md">
          <CreateWorkspaceForm />
        </div>
      </section>
    </main>
  );
}
