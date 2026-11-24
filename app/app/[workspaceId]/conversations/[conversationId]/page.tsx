import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound } from "next/navigation";

import { STATE_LABEL, blockLabel, errorLabel } from "@/src/actions/labels";
import { NotFoundError } from "@/src/auth/errors";
import { can } from "@/src/auth/permissions";
import { formatDateTime } from "@/src/format/intl";
import { getContainer, requireWorkspace } from "@/src/server/runtime";

import {
  CancelButton,
  DiscardButton,
  DraftEditor,
  ResolveButtons,
  SendButton,
} from "./forms";

export const metadata = { title: "Hội thoại — X-Workspace" };

const utc = formatDateTime;

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ workspaceId: string; conversationId: string }>;
}) {
  const { workspaceId, conversationId } = await params;
  const { user, workspace } = await requireWorkspace(workspaceId);
  const { services } = getContainer();
  const thread = await services.threads
    .get({ actorId: user.id, workspaceId, conversationId })
    .catch((e: unknown) => {
      if (e instanceof NotFoundError) notFound();
      throw e;
    });
  const outbound = await services.workspaces.getOutbound({
    actorId: user.id,
    workspaceId,
  });

  const canReply = can(workspace.role, "inbox.reply");
  const canResolve = can(workspace.role, "actions.resolve");
  const open = thread.drafts.find((d) => d.status === "open") ?? null;
  const live = open
    ? thread.actions.find(
        (a) =>
          a.draftId === open.id &&
          [
            "queued",
            "dispatching",
            "send_unknown",
            "cancel_requested",
          ].includes(a.state),
      )
    : undefined;
  // Khoá lũy đẳng cho lần gửi này: cùng một lần dựng trang thì cùng khoá, nên bấm đúp không gửi hai lần.
  const idempotencyKey = randomUUID();
  const c = thread.conversation;

  return (
    <main className="flex flex-col gap-6">
      <div>
        <Link
          href={`/app/${workspaceId}/conversations`}
          className="text-primary underline"
        >
          ← Hội thoại
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{c.participantName}</h1>
        <p className="text-sm text-muted-foreground">
          {c.accountName} ({c.platform})
        </p>
      </div>

      {thread.truncated && (
        <p className="text-muted-foreground">Chỉ hiện các tin mới nhất.</p>
      )}
      {thread.messages.length === 0 ? (
        <p className="text-muted-foreground">
          Chưa có tin nào trong hội thoại này.
        </p>
      ) : (
        <ol className="flex flex-col gap-2" aria-label="Tin nhắn">
          {thread.messages.map((m) => (
            <li
              key={m.id}
              className={`max-w-prose rounded border border-border p-3 ${m.direction === "outgoing" ? "self-end" : "self-start"}`}
            >
              <div className="text-sm text-muted-foreground">
                {m.direction === "outgoing" ? "Đã gửi" : m.author} ·{" "}
                <time dateTime={m.sentAt.toISOString()}>{utc(m.sentAt)}</time>
              </div>
              {/* Nội dung do bên ngoài gửi: văn bản thuần (React tự escape). */}
              <p className="mt-1 whitespace-pre-wrap break-words">{m.text}</p>
            </li>
          ))}
        </ol>
      )}

      {canReply && (
        <section aria-labelledby="reply-title" className="flex flex-col gap-3">
          <h2 id="reply-title" className="text-lg font-medium">
            Trả lời
          </h2>
          {!outbound.enabled && (
            <p role="note" className="rounded border border-border p-3">
              Gửi tin đang tắt cho workspace này: bạn vẫn soạn và lưu nháp được,
              nhưng yêu cầu gửi sẽ bị chặn cho tới khi chủ workspace bật gửi và
              hệ thống cho phép gửi thật.
            </p>
          )}
          <DraftEditor
            key={open ? `${open.id}-${open.currentVersion}` : "new"}
            workspaceId={workspaceId}
            conversationId={conversationId}
            draft={open}
          />
          {open && !live && (
            <div className="flex flex-wrap gap-4">
              <SendButton
                workspaceId={workspaceId}
                conversationId={conversationId}
                draftId={open.id}
                idempotencyKey={idempotencyKey}
              />
              <DiscardButton
                workspaceId={workspaceId}
                conversationId={conversationId}
                draftId={open.id}
              />
            </div>
          )}
        </section>
      )}

      {thread.actions.length > 0 && (
        <section
          aria-labelledby="actions-title"
          className="flex flex-col gap-3"
        >
          <h2 id="actions-title" className="text-lg font-medium">
            Lịch sử gửi
          </h2>
          <ul className="flex flex-col gap-2">
            {thread.actions.map((a) => (
              <li key={a.id} className="rounded border border-border p-3">
                <div className="font-medium">{STATE_LABEL[a.state]}</div>
                <div className="text-sm text-muted-foreground">
                  Nháp phiên bản {a.draftVersion} ·{" "}
                  <time dateTime={a.createdAt.toISOString()}>
                    {utc(a.createdAt)}
                  </time>
                </div>
                {a.state === "blocked" && <p>{blockLabel(a.blockedReason)}</p>}
                {a.state === "failed" && <p>{errorLabel(a.errorCode)}</p>}
                {a.state === "send_unknown" && (
                  <p>
                    Hệ thống không chắc tin đã đi hay chưa nên sẽ không tự gửi
                    lại, tránh gửi trùng cho khách.
                    {a.reconcileResult === "not_found" &&
                      " Đã đối soát nhưng chưa thấy tin trong hội thoại."}
                  </p>
                )}
                {canReply &&
                  (a.state === "queued" || a.state === "dispatching") && (
                    <CancelButton
                      workspaceId={workspaceId}
                      conversationId={conversationId}
                      actionId={a.id}
                    />
                  )}
                {canResolve && a.state === "send_unknown" && (
                  <ResolveButtons
                    workspaceId={workspaceId}
                    conversationId={conversationId}
                    actionId={a.id}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
