import Link from "next/link";
import { notFound } from "next/navigation";

import { NotFoundError } from "@/src/auth/errors";
import { can } from "@/src/auth/permissions";
import { getContainer, requireWorkspace } from "@/src/server/runtime";

import { AliasForm, DecisionForm, RemoveAliasButton } from "./forms";

export const metadata = { title: "Dự án — X-Workspace" };

const utc = (d: Date) =>
  `${d.toISOString().replace("T", " ").slice(0, 16)} UTC`;

const shorten = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s);

const notFoundOn = (e: unknown): never => {
  if (e instanceof NotFoundError) notFound();
  throw e;
};

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ workspaceId: string; projectId: string }>;
}) {
  const { workspaceId, projectId } = await params;
  const { user, workspace } = await requireWorkspace(workspaceId);
  const { knowledge } = getContainer().services;
  const base = { actorId: user.id, workspaceId, projectId };
  const profile = await knowledge.profile(base).catch(notFoundOn);
  const [list, timeline, decisions] = await Promise.all([
    knowledge.list({ actorId: user.id, workspaceId }),
    knowledge.timeline({ ...base, limit: 50 }),
    knowledge.listDecisions({ ...base, includeSuperseded: true }),
  ]);
  const aliases = list.find((p) => p.id === projectId)?.aliases ?? [];
  const canWrite = can(workspace.role, "projects.write");
  const sources = timeline.items.map((i) => ({
    id: i.id,
    label: `${shorten(i.externalId)} (${utc(i.observedAt)})`,
  }));
  const active = decisions
    .filter((d) => d.status === "active")
    .map((d) => ({ id: d.id, label: shorten(d.text) }));

  return (
    <main className="flex flex-col gap-8">
      <div>
        <Link
          href={`/app/${workspaceId}/documents`}
          className="text-primary underline"
        >
          ← Tài liệu và dự án
        </Link>
        <h1 className="text-xl font-semibold">{profile.name}</h1>
        <p className="text-muted-foreground">
          {profile.linked.conversations} hội thoại · {profile.evidenceCount}{" "}
          bằng chứng
          {profile.lastActivityAt
            ? ` · hoạt động gần nhất ${utc(profile.lastActivityAt)}`
            : ""}
        </p>
      </div>

      <section aria-labelledby="alias-title" className="flex flex-col gap-3">
        <h2 id="alias-title" className="text-lg font-medium">
          Bí danh
        </h2>
        {aliases.length === 0 ? (
          <p className="text-muted-foreground">Chưa có bí danh.</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Danh sách bí danh">
            {aliases.map((a) => (
              <li key={a.id} className="flex items-center gap-3">
                <span>{a.alias}</span>
                {canWrite && (
                  <RemoveAliasButton
                    workspaceId={workspaceId}
                    projectId={projectId}
                    aliasId={a.id}
                    alias={a.alias}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {canWrite && (
          <AliasForm workspaceId={workspaceId} projectId={projectId} />
        )}
      </section>

      <section aria-labelledby="decision-title" className="flex flex-col gap-3">
        <h2 id="decision-title" className="text-lg font-medium">
          Sổ quyết định
        </h2>
        {decisions.length === 0 ? (
          <p className="text-muted-foreground">Chưa có quyết định nào.</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Danh sách quyết định">
            {decisions.map((d) => (
              <li key={d.id} className="rounded border border-border p-3">
                <p>{d.text}</p>
                <p className="text-sm text-muted-foreground">
                  {utc(d.decidedAt)} · nguồn: {d.sourceLabel}
                  {d.sourceMissing ? " (nguồn đã bị xoá)" : ""}
                  {d.status === "active" ? "" : " · đã được thay thế"}
                </p>
              </li>
            ))}
          </ul>
        )}
        {canWrite &&
          (sources.length === 0 ? (
            <p className="text-muted-foreground">
              Cần ít nhất một bằng chứng thuộc dự án để ghi quyết định.
            </p>
          ) : (
            <DecisionForm
              workspaceId={workspaceId}
              projectId={projectId}
              sources={sources}
              active={active}
            />
          ))}
      </section>

      <section aria-labelledby="timeline-title" className="flex flex-col gap-3">
        <h2 id="timeline-title" className="text-lg font-medium">
          Dòng thời gian bằng chứng
        </h2>
        {timeline.items.length === 0 ? (
          <p className="text-muted-foreground">Chưa có bằng chứng nào.</p>
        ) : (
          <ul className="flex flex-col gap-1" aria-label="Bằng chứng của dự án">
            {timeline.items.map((i) => (
              <li key={i.id}>
                {utc(i.observedAt)} · {i.source} · {shorten(i.externalId)}
              </li>
            ))}
          </ul>
        )}
        {timeline.nextCursor !== null && (
          <p className="text-sm text-muted-foreground">
            Còn bằng chứng cũ hơn (hiển thị 50 mục mới nhất).
          </p>
        )}
      </section>
    </main>
  );
}
