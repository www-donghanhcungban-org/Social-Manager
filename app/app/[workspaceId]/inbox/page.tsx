import Link from "next/link";

import { can } from "@/src/auth/permissions";
import { INBOX_KINDS, INBOX_STATUSES, type InboxStatus } from "@/src/db/schema";
import { ValidationError, type InboxKind } from "@/src/providers/types";
import { getContainer, requireWorkspace } from "@/src/server/runtime";

import { setStatusAction } from "./actions";
import { SyncButton } from "./sync-button";

export const metadata = { title: "Hộp thư — Social Manager" };

const KIND_LABEL: Record<InboxKind, string> = {
  dm: "Tin nhắn",
  comment: "Bình luận",
  review: "Đánh giá",
  mention: "Lượt nhắc",
};
const STATUS_LABEL: Record<InboxStatus, string> = {
  open: "Chưa xử lý",
  handled: "Đã xử lý",
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const { user, workspace } = await requireWorkspace(workspaceId);

  // Tham số lọc là đầu vào của người dùng: chỉ nhận giá trị trong danh sách, còn lại bỏ qua.
  const kind = (INBOX_KINDS as readonly string[]).includes(one(sp.kind) ?? "")
    ? (one(sp.kind) as InboxKind)
    : undefined;
  const status = (INBOX_STATUSES as readonly string[]).includes(
    one(sp.status) ?? "",
  )
    ? (one(sp.status) as InboxStatus)
    : undefined;
  const cursor = one(sp.cursor);

  const { services } = getContainer();
  let page;
  let cursorInvalid = false;
  try {
    page = await services.inbox.list({
      actorId: user.id,
      workspaceId,
      kind,
      status,
      cursor,
    });
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e;
    cursorInvalid = true;
    page = await services.inbox.list({
      actorId: user.id,
      workspaceId,
      kind,
      status,
    });
  }
  const accounts = await services.accounts.list({
    actorId: user.id,
    workspaceId,
  });
  const accountName = new Map(accounts.map((a) => [a.id, a.displayName]));
  const canReply = can(workspace.role, "inbox.reply");

  const base = `/app/${workspaceId}/inbox`;
  const href = (over: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const next = { kind, status, ...over };
    for (const [k, v] of Object.entries(next)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  const chip = (active: boolean) =>
    `rounded border px-3 py-1 ${active ? "border-primary bg-primary text-primary-foreground" : "border-border"}`;

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Hộp thư</h1>

      <section aria-labelledby="sync-title">
        <h2 id="sync-title" className="text-lg font-medium">
          Đồng bộ
        </h2>
        {accounts.length === 0 ? (
          <p className="mt-2 text-muted-foreground">
            Chưa có tài khoản nào.{" "}
            <Link
              href={`/app/${workspaceId}/connections`}
              className="text-primary underline"
            >
              Thêm ở mục Kết nối
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {accounts.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <span>
                  {a.displayName}{" "}
                  <span className="text-sm text-muted-foreground">
                    ({a.platform})
                  </span>
                </span>
                <SyncButton
                  workspaceId={workspaceId}
                  accountId={a.id}
                  name={a.displayName}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <nav aria-label="Bộ lọc hộp thư" className="flex flex-wrap gap-2">
        <Link href={href({ kind: undefined })} className={chip(!kind)}>
          Mọi loại
        </Link>
        {INBOX_KINDS.map((k) => (
          <Link
            key={k}
            href={href({ kind: k })}
            className={chip(kind === k)}
            aria-current={kind === k ? "true" : undefined}
          >
            {KIND_LABEL[k]}
          </Link>
        ))}
        <span aria-hidden className="mx-2 border-l border-border" />
        <Link href={href({ status: undefined })} className={chip(!status)}>
          Mọi trạng thái
        </Link>
        {INBOX_STATUSES.map((s) => (
          <Link
            key={s}
            href={href({ status: s })}
            className={chip(status === s)}
            aria-current={status === s ? "true" : undefined}
          >
            {STATUS_LABEL[s]}
          </Link>
        ))}
      </nav>

      {cursorInvalid && (
        <p role="alert" className="text-danger">
          Liên kết phân trang không hợp lệ, đã quay về trang đầu.
        </p>
      )}

      {page.items.length === 0 ? (
        <p className="text-muted-foreground">
          Không có tin nào. Bấm Đồng bộ để lấy tin mới.
        </p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Danh sách tin">
          {page.items.map((m) => (
            <li
              key={m.id}
              className="rounded border border-border p-3"
              aria-label={`${KIND_LABEL[m.kind]} từ ${m.author}`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{m.author}</span>
                <span className="text-sm text-muted-foreground">
                  {KIND_LABEL[m.kind]} ·{" "}
                  {accountName.get(m.socialAccountId) ?? "tài khoản đã xoá"} ·{" "}
                  <time dateTime={m.receivedAt.toISOString()}>
                    {m.receivedAt.toISOString().replace("T", " ").slice(0, 16)}{" "}
                    UTC
                  </time>
                </span>
              </div>
              {/* Nội dung do bên ngoài gửi: render như văn bản thuần (React tự escape), giữ xuống dòng. */}
              <p className="mt-2 whitespace-pre-wrap break-words">
                {m.text === "" ? "(không có nội dung văn bản)" : m.text}
              </p>
              <div className="mt-2 flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {STATUS_LABEL[m.status]}
                </span>
                {canReply && (
                  <form
                    action={setStatusAction.bind(
                      null,
                      workspaceId,
                      m.id,
                      m.status === "open" ? "handled" : "open",
                    )}
                  >
                    <button
                      type="submit"
                      className="text-sm text-primary underline"
                      aria-label={`${m.status === "open" ? "Đánh dấu đã xử lý" : "Mở lại"}: tin của ${m.author}`}
                    >
                      {m.status === "open" ? "Đánh dấu đã xử lý" : "Mở lại"}
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {page.nextCursor && (
        <Link
          href={href({ cursor: page.nextCursor })}
          className="self-start text-primary underline"
        >
          Tải thêm
        </Link>
      )}
    </main>
  );
}
