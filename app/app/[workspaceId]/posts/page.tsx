import Link from "next/link";

import { can } from "@/src/auth/permissions";
import type { PostStatus } from "@/src/db/schema";
import { getContainer, requireWorkspace } from "@/src/server/runtime";

import { PostForm } from "./post-form";

export const metadata = { title: "Đăng bài — X-Workspace" };

const STATUS_LABEL: Record<PostStatus, string> = {
  scheduled: "Đã xếp lịch",
  publishing: "Đang đăng",
  published: "Đã đăng",
  failed: "Lỗi",
};

const ERROR_LABEL: Record<string, string> = {
  interrupted:
    "bị gián đoạn, cần kiểm tra thủ công trên nền tảng trước khi đăng lại",
  provider_unavailable: "nguồn dữ liệu không còn khả dụng",
  credentials_unreadable: "không đọc được khoá của kết nối",
  account_missing: "tài khoản đã bị xoá",
  validation: "nội dung không hợp lệ với nền tảng",
  not_implemented: "tính năng chưa được cài cho nguồn dữ liệu này",
  unsupported: "nguồn dữ liệu không hỗ trợ nền tảng này",
  internal: "lỗi nội bộ",
};

export default async function PostsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const { user, workspace } = await requireWorkspace(workspaceId);
  const { services } = getContainer();
  const [posts, accounts] = await Promise.all([
    services.posts.list({ actorId: user.id, workspaceId }),
    services.accounts.list({ actorId: user.id, workspaceId }),
  ]);
  const name = new Map(accounts.map((a) => [a.id, a.displayName]));
  const canPublish = can(workspace.role, "posts.publish");

  return (
    <main className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold">Đăng bài</h1>

      {canPublish &&
        (accounts.length === 0 ? (
          <p className="text-muted-foreground">
            Cần ít nhất một tài khoản để đăng bài.{" "}
            <Link
              href={`/app/${workspaceId}/connections`}
              className="text-primary underline"
            >
              Thêm ở mục Kết nối
            </Link>
            .
          </p>
        ) : (
          <section aria-labelledby="new-post">
            <h2 id="new-post" className="text-lg font-medium">
              Bài mới
            </h2>
            <div className="mt-3">
              <PostForm
                workspaceId={workspaceId}
                accounts={accounts.map((a) => ({
                  id: a.id,
                  name: a.displayName,
                  platform: a.platform,
                }))}
              />
            </div>
          </section>
        ))}

      <section aria-labelledby="post-list">
        <h2 id="post-list" className="text-lg font-medium">
          Lịch và lịch sử
        </h2>
        {posts.length === 0 ? (
          <p className="mt-2 text-muted-foreground">Chưa có bài nào.</p>
        ) : (
          <ul
            className="mt-3 flex flex-col gap-3"
            aria-label="Danh sách bài đăng"
          >
            {posts.map((p) => (
              <li key={p.id} className="rounded border border-border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {name.get(p.socialAccountId) ?? "tài khoản đã xoá"}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    <time dateTime={p.scheduledAt.toISOString()}>
                      {p.scheduledAt
                        .toISOString()
                        .replace("T", " ")
                        .slice(0, 16)}{" "}
                      UTC
                    </time>
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words">{p.text}</p>
                <p
                  className={`mt-2 text-sm ${p.status === "failed" ? "text-danger" : "text-muted-foreground"}`}
                >
                  {STATUS_LABEL[p.status]}
                  {p.status === "failed" && p.errorCode
                    ? `: ${ERROR_LABEL[p.errorCode] ?? `mã lỗi ${p.errorCode}`}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
