import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

import type { Db } from "../auth/members";
import type { Env } from "../config/env";
import { poolConfig } from "../db/client";
import * as schema from "../db/schema";
import { socialAccounts, providerConnections } from "../db/schema";
import { createConnectionService } from "../connections/service";
import { createInboxService } from "../inbox/service";
import { createWebhookIngest } from "../inbox/webhook";
import { createPostService } from "../posts/service";
import { createRetentionService } from "../retention/service";
import { createDemoProvider } from "../providers/demo";
import { createRegistry } from "../providers/registry";
import { createSocialApiProvider } from "../providers/socialapi";
import type { SocialProvider } from "../providers/types";
import { createSecretBox } from "../security/secret-box";
import { createWorkspaceService } from "../workspaces/service";
import { createAccountService } from "../accounts/service";
import { eq } from "drizzle-orm";

/**
 * Nơi duy nhất nối các phần lại với nhau (composition root). Thêm nhà cung cấp mới: thêm một nhánh
 * ở `buildProvider` và một dòng đăng ký ở registry — phần còn lại của app không đổi.
 */
export function createContainer(cfg: Env) {
  const pool = new Pool(poolConfig(cfg.DATABASE_URL));
  const db = drizzle(pool, { schema }) as unknown as Db;
  const box = createSecretBox(cfg.APP_SECRET_KEY);

  /** Provider theo kết nối: khoá nằm trong provider, nên dựng mới cho mỗi lần dùng. */
  function buildProvider(
    id: string,
    credentials: string,
  ): SocialProvider | undefined {
    switch (id) {
      case "demo":
        return createDemoProvider({ now: () => new Date() });
      case "socialapi":
        return createSocialApiProvider({
          apiKey: credentials,
          baseUrl: cfg.SOCIALAPI_BASE_URL,
        });
      default:
        return undefined;
    }
  }

  // Registry chỉ để biết provider nào tồn tại và hỗ trợ gì; khoá giả vì không gọi mạng từ đây.
  const registry = createRegistry();
  registry.register(buildProvider("demo", "")!);
  registry.register(buildProvider("socialapi", "-")!);

  const services = {
    workspaces: createWorkspaceService({ db }),
    accounts: createAccountService({ db, registry }),
    connections: createConnectionService({ db, box, registry }),
    posts: createPostService({ db, box, resolveProvider: buildProvider }),
    inbox: createInboxService({ db, box, resolveProvider: buildProvider }),
    retention: createRetentionService({ db }),
    webhooks: createWebhookIngest({ db, box }),
  };

  /** Mọi tài khoản mạng xã hội của mọi workspace, cho job đồng bộ định kỳ. */
  async function listAccounts() {
    const rows = await db
      .select({
        workspaceId: providerConnections.workspaceId,
        accountId: socialAccounts.id,
      })
      .from(socialAccounts)
      .innerJoin(
        providerConnections,
        eq(socialAccounts.connectionId, providerConnections.id),
      );
    return rows;
  }

  return {
    db,
    registry,
    services,
    resolveProvider: buildProvider,
    listAccounts,
    close: () => pool.end(),
  };
}

export type Container = ReturnType<typeof createContainer>;
