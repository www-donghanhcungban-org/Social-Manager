import { notFound } from "next/navigation";

import { UUID } from "@/src/auth/access";
import { getContainer, requireUser } from "@/src/server/runtime";

export default async function WorkspaceHome({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const user = await requireUser();
  if (!UUID.test(workspaceId)) notFound();
  const mine = await getContainer().services.workspaces.listForUser(user.id);
  // Không phải thành viên và không tồn tại cho cùng một kết quả (không lộ workspace có thật hay không).
  const ws = mine.find((w) => w.id === workspaceId);
  if (!ws) notFound();
  return (
    <main>
      <h1 className="text-xl font-semibold">{ws.name}</h1>
      <p className="mt-2 text-muted-foreground">
        Vai trò của bạn: {ws.role}. Hộp thư, đăng bài và kết nối sẽ ở đây.
      </p>
    </main>
  );
}
