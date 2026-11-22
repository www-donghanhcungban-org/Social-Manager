import { requireWorkspace } from "@/src/server/runtime";

export default async function WorkspaceHome({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const { workspace } = await requireWorkspace(workspaceId);
  return (
    <main>
      <h1 className="text-xl font-semibold">{workspace.name}</h1>
      <p className="mt-2 text-muted-foreground">
        Vai trò của bạn: {workspace.role}. Bắt đầu bằng việc thêm một kết nối
        nguồn dữ liệu ở mục Kết nối.
      </p>
    </main>
  );
}
