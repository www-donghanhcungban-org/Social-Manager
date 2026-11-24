import { randomBytes } from "node:crypto";

import { createAuth } from "@/src/auth/auth";
import type { Db } from "@/src/auth/members";
import { createDraftService } from "@/src/actions/drafts";
import { createConnectionService } from "@/src/connections/service";
import { createThreadService } from "@/src/conversations/threads";
import { createMemoryBlobStore } from "@/src/evidence/blob-store";
import { createEvidenceService } from "@/src/evidence/service";
import { createWebhookIngest } from "@/src/inbox/webhook";
import { createKnowledgeService } from "@/src/knowledge/service";
import { createAccountService } from "@/src/accounts/service";
import { createDemoProvider } from "@/src/providers/demo";
import { createRegistry } from "@/src/providers/registry";
import { createSocialApiProvider } from "@/src/providers/socialapi";
import { createSecretBox } from "@/src/security/secret-box";
import type { Container } from "@/src/server/container";
import { createWorkspaceService } from "@/src/workspaces/service";

import { createTestDb } from "../../db/helpers";

/**
 * "Thế giới" cho test tấn công: Postgres thật trong tiến trình (PGlite + migration thật), Better Auth thật (phiên, cookie,
 * giới hạn tần suất) và các dịch vụ thật nối giống `src/server/container.ts` — chỉ khác CSDL là PGlite, kho blob trong bộ
 * nhớ và đồng hồ tiêm được. Không gọi mạng: không dịch vụ nào ở đây tự `fetch`.
 */
export const AUTH_SECRET = "s".repeat(48);
export const PASSWORD = "mat-khau-du-dai-123";

export async function createWorld(opts: { now?: () => number } = {}) {
  const t = await createTestDb();
  const db = t.db as unknown as Db;
  const box = createSecretBox(randomBytes(32).toString("base64"));
  const evidence = createEvidenceService({
    db,
    store: createMemoryBlobStore(),
  });
  const registry = createRegistry();
  registry.register(createDemoProvider({ now: () => new Date() }));
  registry.register(createSocialApiProvider({ apiKey: "-" }));

  const services = {
    workspaces: createWorkspaceService({ db }),
    accounts: createAccountService({ db, registry }),
    connections: createConnectionService({ db, box, registry }),
    threads: createThreadService({ db }),
    drafts: createDraftService({ db }),
    evidence,
    knowledge: createKnowledgeService({ db, evidence }),
    webhooks: createWebhookIngest({ db, box, now: opts.now, evidence }),
  };
  // Chỉ phần dịch vụ mà trang/action/route được kiểm dùng tới; thiếu dịch vụ nào thì test ném lỗi rõ ràng.
  const container = { db, registry, services } as unknown as Container;

  const auth = createAuth({
    db,
    secret: AUTH_SECRET,
    baseURL: "http://localhost:3000",
  });

  /** Đăng ký + đăng nhập thật, trả id người dùng và header mang cookie phiên (như trình duyệt gửi lên). */
  async function login(email: string) {
    await auth.api.signUpEmail({
      body: { name: email.split("@")[0]!, email, password: PASSWORD },
    });
    const { headers, response } = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      returnHeaders: true,
    });
    const cookie = headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    return { id: response.user.id, headers: new Headers({ cookie }) };
  }

  return { t, db, box, auth, container, services, login };
}

export type World = Awaited<ReturnType<typeof createWorld>>;

/** `notFound()`/`redirect()` của Next ném lỗi mang `digest`; đây là cách Next tự nhận ra chúng. */
export function nextSignal(e: unknown): "not_found" | "redirect" | null {
  const digest = (e as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string") return null;
  if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return "not_found";
  if (digest.startsWith("NEXT_REDIRECT")) return "redirect";
  return null;
}

/** Kết quả của một lời gọi: giá trị trả về, tín hiệu Next, hoặc lỗi khác. */
export async function outcome<T>(p: Promise<T>) {
  try {
    return { ok: true as const, value: await p };
  } catch (e) {
    return { ok: false as const, signal: nextSignal(e), error: e };
  }
}
