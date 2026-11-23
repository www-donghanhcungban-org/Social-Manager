import Link from "next/link";
import type { ReactNode } from "react";

import { requireWorkspace } from "@/src/server/runtime";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const { workspace } = await requireWorkspace(workspaceId);
  const base = `/app/${workspace.id}`;
  return (
    <div className="flex flex-col gap-4">
      <nav
        aria-label={`Điều hướng ${workspace.name}`}
        className="flex flex-wrap items-center gap-4 border-b border-border pb-3"
      >
        <span className="font-semibold">{workspace.name}</span>
        <Link href={base} className="text-primary underline">
          Tổng quan
        </Link>
        <Link href={`${base}/inbox`} className="text-primary underline">
          Hộp thư
        </Link>
        <Link href={`${base}/conversations`} className="text-primary underline">
          Hội thoại
        </Link>
        <Link href={`${base}/documents`} className="text-primary underline">
          Tài liệu
        </Link>
        <Link href={`${base}/search`} className="text-primary underline">
          Tìm kiếm
        </Link>
        <Link href={`${base}/posts`} className="text-primary underline">
          Đăng bài
        </Link>
        <Link href={`${base}/connections`} className="text-primary underline">
          Kết nối
        </Link>
      </nav>
      {children}
    </div>
  );
}
