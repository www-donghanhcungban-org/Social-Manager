import { can } from "@/src/auth/permissions";
import { formatDateTime } from "@/src/format/intl";
import { getContainer, requireWorkspace } from "@/src/server/runtime";
import { CONSENT_TEXT } from "@/src/workspaces/consent";

import { AiConsentForm } from "./ai-consent-form";
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
  const svc = getContainer().services.workspaces;
  const aiCloud = await svc.getAiCloud({ actorId: user.id, workspaceId });
  const isOwner = can(workspace.role, "workspace.settings");
  const history = isOwner
    ? await svc.consentHistory({ actorId: user.id, workspaceId })
    : [];
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

      <section aria-labelledby="ai-cloud-heading" className="mt-8">
        <h2 id="ai-cloud-heading" className="text-lg font-semibold">
          AI đám mây
        </h2>
        <p className="mt-2" data-consent-text>
          {CONSENT_TEXT.ai_cloud}
        </p>
        <p className="mt-2" data-consent-state>
          {aiCloud.enabled
            ? "Trạng thái: đã đồng ý, dữ liệu có thể được gửi tới AI đám mây."
            : "Trạng thái: chưa đồng ý (hoặc đã rút), không có dữ liệu nào gửi tới AI đám mây."}
        </p>
        {isOwner ? (
          <div className="mt-4">
            <AiConsentForm
              workspaceId={workspaceId}
              enabled={aiCloud.enabled}
            />
            {history.length > 0 && (
              <ul
                className="mt-4 flex flex-col gap-1 text-sm"
                aria-label="Lịch sử đồng ý"
              >
                {history.map((h) => (
                  <li
                    key={`${h.grantedAt.toISOString()}-${h.withdrawnAt?.toISOString() ?? "grant"}`}
                  >
                    {h.withdrawnAt
                      ? `Rút đồng ý lúc ${formatDateTime(h.withdrawnAt)}`
                      : `Đồng ý lúc ${formatDateTime(h.grantedAt)}`}{" "}
                    (văn bản {h.policyVersion}, kênh {h.channel})
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="mt-2 text-muted-foreground">
            Chỉ chủ workspace cấp hoặc rút đồng ý.
          </p>
        )}
      </section>
    </main>
  );
}
