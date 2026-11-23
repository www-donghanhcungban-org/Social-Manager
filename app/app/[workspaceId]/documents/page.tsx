import Link from "next/link";

import { can } from "@/src/auth/permissions";
import { getContainer, requireWorkspace } from "@/src/server/runtime";

import { AliasForm, ImportForm, ProjectForm, RemoveAliasForm } from "./forms";

export const metadata = { title: "Tài liệu và dự án — X-Workspace" };

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const { user, workspace } = await requireWorkspace(workspaceId);
  const projects = await getContainer().services.knowledge.list({
    actorId: user.id,
    workspaceId,
  });
  const canWrite = can(workspace.role, "evidence.write");
  const canProject = can(workspace.role, "projects.write");

  return (
    <main className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold">Tài liệu và dự án</h1>

      <section aria-labelledby="import-title" className="flex flex-col gap-3">
        <h2 id="import-title" className="text-lg font-medium">
          Nhập tài liệu
        </h2>
        {canWrite ? (
          <ImportForm workspaceId={workspaceId} />
        ) : (
          <p className="text-muted-foreground">
            Chỉ quản trị viên và chủ workspace nhập được tài liệu.
          </p>
        )}
      </section>

      <section aria-labelledby="projects-title" className="flex flex-col gap-3">
        <h2 id="projects-title" className="text-lg font-medium">
          Dự án
        </h2>
        {projects.length === 0 ? (
          <p className="text-muted-foreground">Chưa có dự án nào.</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Danh sách dự án">
            {projects.map((p) => (
              <li key={p.id} className="rounded border border-border p-3">
                <Link
                  href={`/app/${workspaceId}/projects/${p.id}`}
                  className="font-medium text-primary underline"
                >
                  {p.name}
                </Link>
                {p.aliases.length > 0 && (
                  <ul
                    className="mt-2 flex flex-wrap gap-3 text-sm text-muted-foreground"
                    aria-label={`Bí danh của ${p.name}`}
                  >
                    {p.aliases.map((a) => (
                      <li key={a.id}>
                        {canProject ? (
                          <RemoveAliasForm
                            workspaceId={workspaceId}
                            aliasId={a.id}
                            alias={a.alias}
                          />
                        ) : (
                          a.alias
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {canProject && (
                  <AliasForm
                    workspaceId={workspaceId}
                    projectId={p.id}
                    projectName={p.name}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {canProject && <ProjectForm workspaceId={workspaceId} />}
      </section>
    </main>
  );
}
