import { can } from "@/src/auth/permissions";
import { getContainer, requireWorkspace } from "@/src/server/runtime";

import { RetentionForm } from "./retention-form";

export default async function WorkspaceHome({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const { workspace, user } = await requireWorkspace(workspaceId);
  const retention = await getContainer().services.workspaces.getRetention({
    actorId: user.id,
    workspaceId,
  });
  return (
    <main>
      <h1 className="text-xl font-semibold">{workspace.name}</h1>
      <p className="mt-2 text-muted-foreground">
        Vai trò của bạn: {workspace.role}. Bắt đầu bằng việc thêm một kết nối
        nguồn dữ liệu ở mục Kết nối.
      </p>

      <section aria-labelledby="retention-heading" className="mt-8">
        <h2 id="retention-heading" className="text-lg font-semibold">
          Thời hạn lưu tin nhắn
        </h2>
        <p className="mt-2">
          {retention.effectiveDays === null
            ? "Đang giữ tin nhắn vô thời hạn."
            : `Tin nhắn và mục hộp thư được xoá sau ${retention.effectiveDays} ngày.`}
        </p>
        {can(workspace.role, "workspace.settings") ? (
          <div className="mt-4">
            <RetentionForm
              workspaceId={workspaceId}
              days={retention.days}
              forever={retention.forever}
            />
          </div>
        ) : (
          <p className="mt-2 text-muted-foreground">
            Chỉ chủ workspace đổi được thời hạn này.
          </p>
        )}
      </section>
    </main>
  );
}
