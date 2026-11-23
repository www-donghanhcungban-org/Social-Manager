import Link from "next/link";

import { ValidationError } from "@/src/providers/types";
import { getContainer, requireWorkspace } from "@/src/server/runtime";

export const metadata = { title: "Hội thoại — X-Workspace" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ConversationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  const sp = await searchParams;
  const { user } = await requireWorkspace(workspaceId);
  const { threads } = getContainer().services;
  let page;
  let cursorInvalid = false;
  try {
    page = await threads.list({
      actorId: user.id,
      workspaceId,
      cursor: one(sp.cursor),
    });
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e;
    cursorInvalid = true;
    page = await threads.list({ actorId: user.id, workspaceId });
  }
  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Hội thoại</h1>
      {cursorInvalid && (
        <p role="alert" className="text-danger">
          Liên kết phân trang không hợp lệ, đã quay về trang đầu.
        </p>
      )}
      {page.items.length === 0 ? (
        <p className="text-muted-foreground">
          Chưa có hội thoại nào. Đồng bộ tin ở mục Hộp thư để lấy về.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Danh sách hội thoại">
          {page.items.map((c) => (
            <li key={c.id}>
              <Link
                href={`/app/${workspaceId}/conversations/${c.id}`}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded border border-border p-3"
              >
                <span className="font-medium">{c.participantName}</span>
                <span className="text-sm text-muted-foreground">
                  {c.accountName} ({c.platform}) ·{" "}
                  {c.lastMessageAt
                    ? `${c.lastMessageAt.toISOString().replace("T", " ").slice(0, 16)} UTC`
                    : "chưa có tin"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {page.nextCursor && (
        <Link
          href={`/app/${workspaceId}/conversations?cursor=${encodeURIComponent(page.nextCursor)}`}
          className="self-start text-primary underline"
        >
          Tải thêm
        </Link>
      )}
    </main>
  );
}
