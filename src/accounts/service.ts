import { and, asc, eq } from "drizzle-orm";

import { requireAction, UUID } from "../auth/access";
import { ConflictError, NotFoundError } from "../auth/errors";
import type { Db } from "../auth/members";
import { providerConnections, socialAccounts } from "../db/schema";
import type { ProviderRegistry } from "../providers/registry";
import { PLATFORMS, ValidationError, type Platform } from "../providers/types";

export interface AccountView {
  id: string;
  connectionId: string;
  platform: string;
  externalId: string;
  displayName: string;
}

export interface AccountListItem extends AccountView {
  connectionLabel: string;
  provider: string;
}

const MAX_FIELD = 200;
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(e: unknown): boolean {
  for (let cur = e, i = 0; cur && i < 5; i++) {
    if ((cur as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

const view = (r: typeof socialAccounts.$inferSelect): AccountView => ({
  id: r.id,
  connectionId: r.connectionId,
  platform: r.platform,
  externalId: r.externalId,
  displayName: r.displayName,
});

const clean = (value: string, label: string) => {
  const v = value.normalize("NFC").trim();
  if (v === "" || v.length > MAX_FIELD)
    throw new ValidationError(`${label} phải dài 1-${MAX_FIELD} ký tự`);
  return v;
};

export function createAccountService({
  db,
  registry,
}: {
  db: Db;
  registry: ProviderRegistry;
}) {
  return {
    async add(input: {
      actorId: string;
      workspaceId: string;
      connectionId: string;
      platform: string;
      externalId: string;
      displayName: string;
    }): Promise<AccountView> {
      await requireAction(
        db,
        input.actorId,
        input.workspaceId,
        "connections.manage",
      );
      if (!UUID.test(input.connectionId)) throw new NotFoundError();
      const [conn] = await db
        .select({ provider: providerConnections.provider })
        .from(providerConnections)
        .where(
          and(
            eq(providerConnections.id, input.connectionId),
            eq(providerConnections.workspaceId, input.workspaceId),
          ),
        );
      if (!conn) throw new NotFoundError();

      const provider = registry.get(conn.provider);
      const supported =
        provider !== undefined &&
        (PLATFORMS as readonly string[]).includes(input.platform) &&
        Object.hasOwn(provider.support, input.platform) &&
        (provider.support[input.platform as Platform]?.length ?? 0) > 0;
      if (!supported)
        throw new ValidationError("Nguồn dữ liệu này không hỗ trợ nền tảng đó");

      const externalId = clean(input.externalId, "Mã tài khoản");
      const displayName = clean(input.displayName, "Tên hiển thị");
      try {
        const [row] = await db
          .insert(socialAccounts)
          .values({
            connectionId: input.connectionId,
            platform: input.platform,
            externalId,
            displayName,
          })
          .returning();
        return view(row!);
      } catch (e) {
        if (isUniqueViolation(e))
          throw new ConflictError(
            "duplicate_account",
            "Tài khoản này đã được thêm vào kết nối",
          );
        throw e;
      }
    },

    async list(input: {
      actorId: string;
      workspaceId: string;
    }): Promise<AccountListItem[]> {
      await requireAction(db, input.actorId, input.workspaceId, "inbox.read");
      const rows = await db
        .select({
          account: socialAccounts,
          label: providerConnections.label,
          provider: providerConnections.provider,
        })
        .from(socialAccounts)
        .innerJoin(
          providerConnections,
          eq(socialAccounts.connectionId, providerConnections.id),
        )
        .where(eq(providerConnections.workspaceId, input.workspaceId))
        .orderBy(asc(socialAccounts.displayName), asc(socialAccounts.id));
      return rows.map((r) => ({
        ...view(r.account),
        connectionLabel: r.label,
        provider: r.provider,
      }));
    },

    async remove(input: {
      actorId: string;
      workspaceId: string;
      accountId: string;
    }): Promise<void> {
      await requireAction(
        db,
        input.actorId,
        input.workspaceId,
        "connections.manage",
      );
      if (!UUID.test(input.accountId)) throw new NotFoundError();
      // Chỉ xoá khi tài khoản thuộc một kết nối của đúng workspace này.
      const [owned] = await db
        .select({ id: socialAccounts.id })
        .from(socialAccounts)
        .innerJoin(
          providerConnections,
          eq(socialAccounts.connectionId, providerConnections.id),
        )
        .where(
          and(
            eq(socialAccounts.id, input.accountId),
            eq(providerConnections.workspaceId, input.workspaceId),
          ),
        );
      if (!owned) throw new NotFoundError();
      await db
        .delete(socialAccounts)
        .where(eq(socialAccounts.id, input.accountId));
    },
  };
}

export type AccountService = ReturnType<typeof createAccountService>;
