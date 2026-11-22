import { can } from "@/src/auth/permissions";
import { PLATFORMS } from "@/src/providers/types";
import { getContainer, requireWorkspace } from "@/src/server/runtime";

import { loadEnv, processEnv } from "@/src/config/env";

import {
  clearWebhookSecretAction,
  removeAccountAction,
  removeConnectionAction,
} from "./actions";
import { AddAccountForm, AddConnectionForm, WebhookSecretForm } from "./forms";

export const metadata = { title: "Kết nối — X-Workspace" };

export default async function ConnectionsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const { user, workspace } = await requireWorkspace(workspaceId);
  const { services, registry } = getContainer();
  const [connections, accounts] = await Promise.all([
    services.connections.list({ actorId: user.id, workspaceId }),
    services.accounts.list({ actorId: user.id, workspaceId }),
  ]);
  const canManage = can(workspace.role, "connections.manage");
  const providers = registry.list().map((p) => ({ id: p.id, label: p.label }));
  // URL công khai của app (BETTER_AUTH_URL), bỏ dấu `/` cuối để ghép đường dẫn không bị `//`.
  const publicUrl = loadEnv(processEnv()).BETTER_AUTH_URL.replace(/\/+$/, "");

  return (
    <main className="flex flex-col gap-8">
      <section aria-labelledby="conn-title">
        <h1 id="conn-title" className="text-xl font-semibold">
          Kết nối nguồn dữ liệu
        </h1>
        {connections.length === 0 ? (
          <p className="mt-2 text-muted-foreground">
            Chưa có kết nối nào.
            {canManage
              ? " Thêm kết nối đầu tiên bên dưới."
              : " Nhờ quản trị viên thêm kết nối."}
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-6">
            {connections.map((c) => {
              const mine = accounts.filter((a) => a.connectionId === c.id);
              const provider = registry.get(c.provider);
              const platforms = PLATFORMS.filter(
                (p) =>
                  provider &&
                  Object.hasOwn(provider.support, p) &&
                  (provider.support[p]?.length ?? 0) > 0,
              );
              return (
                <li
                  key={c.id}
                  className="rounded border border-border p-4"
                  aria-label={`Kết nối ${c.label}`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <h2 className="font-medium">
                      {c.label}{" "}
                      <span className="text-sm text-muted-foreground">
                        ({provider?.label ?? c.provider})
                      </span>
                    </h2>
                    {canManage && (
                      <form
                        action={removeConnectionAction.bind(
                          null,
                          workspaceId,
                          c.id,
                        )}
                      >
                        <button
                          type="submit"
                          className="text-sm text-danger underline"
                          aria-label={`Xoá kết nối ${c.label}`}
                        >
                          Xoá kết nối
                        </button>
                      </form>
                    )}
                  </div>
                  {mine.length === 0 ? (
                    <p className="mt-2 text-muted-foreground">
                      Chưa có tài khoản nào.
                    </p>
                  ) : (
                    <ul className="mt-3 flex flex-col gap-2">
                      {mine.map((a) => (
                        <li
                          key={a.id}
                          className="flex items-center justify-between gap-4 rounded bg-muted px-3 py-2"
                        >
                          <span>
                            <span className="font-medium">{a.displayName}</span>{" "}
                            <span className="text-sm text-muted-foreground">
                              {a.platform} · {a.externalId}
                            </span>
                          </span>
                          {canManage && (
                            <form
                              action={removeAccountAction.bind(
                                null,
                                workspaceId,
                                a.id,
                              )}
                            >
                              <button
                                type="submit"
                                className="text-sm text-danger underline"
                                aria-label={`Xoá tài khoản ${a.displayName}`}
                              >
                                Xoá
                              </button>
                            </form>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {canManage && c.provider === "socialapi" && (
                    <details className="mt-4">
                      <summary className="cursor-pointer text-primary underline">
                        Nhận tin theo thời gian thực (webhook)
                        {c.webhookEnabled ? " — đã bật" : ""}
                      </summary>
                      <div className="mt-3 flex flex-col gap-3">
                        <p className="text-sm">
                          Trong SocialAPI, tạo webhook trỏ tới địa chỉ này rồi
                          dán secret vào ô bên dưới:
                        </p>
                        <code
                          className="block break-all rounded bg-muted px-3 py-2 text-sm"
                          aria-label={`Địa chỉ webhook của ${c.label}`}
                        >
                          {`${publicUrl}/api/webhooks/socialapi/${c.id}`}
                        </code>
                        <WebhookSecretForm
                          workspaceId={workspaceId}
                          connectionId={c.id}
                        />
                        {c.webhookEnabled && (
                          <form
                            action={clearWebhookSecretAction.bind(
                              null,
                              workspaceId,
                              c.id,
                            )}
                          >
                            <button
                              type="submit"
                              className="text-sm text-danger underline"
                            >
                              Tắt webhook (xoá secret)
                            </button>
                          </form>
                        )}
                      </div>
                    </details>
                  )}
                  {canManage && platforms.length > 0 && (
                    <details className="mt-4">
                      <summary className="cursor-pointer text-primary underline">
                        Thêm tài khoản vào kết nối này
                      </summary>
                      <div className="mt-3">
                        <AddAccountForm
                          workspaceId={workspaceId}
                          connectionId={c.id}
                          platforms={platforms}
                        />
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {canManage && (
        <section aria-labelledby="conn-new">
          <h2 id="conn-new" className="text-lg font-medium">
            Thêm kết nối
          </h2>
          <div className="mt-3">
            <AddConnectionForm
              workspaceId={workspaceId}
              providers={providers}
            />
          </div>
        </section>
      )}
    </main>
  );
}
