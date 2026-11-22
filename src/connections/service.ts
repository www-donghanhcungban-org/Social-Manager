import { and, asc, eq } from "drizzle-orm";

import { ConflictError, ForbiddenError, NotFoundError } from "../auth/errors";
import { getRole, type Db } from "../auth/members";
import { can } from "../auth/permissions";
import { providerConnections } from "../db/schema";
import type { ProviderRegistry } from "../providers/registry";
import { ValidationError } from "../providers/types";
import type { SecretBox } from "../security/secret-box";

/** Dạng trả ra ngoài: KHÔNG bao giờ có khoá (cả bản mã). */
export interface ConnectionView {
  id: string;
  workspaceId: string;
  provider: string;
  label: string;
  createdAt: Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNIQUE_VIOLATION = "23505";

const view = (r: typeof providerConnections.$inferSelect): ConnectionView => ({
  id: r.id,
  workspaceId: r.workspaceId,
  provider: r.provider,
  label: r.label,
  createdAt: r.createdAt,
});

/** Drizzle bọc lỗi của driver trong `cause`: kiểm cả hai tầng. */
function isUniqueViolation(e: unknown): boolean {
  for (let cur = e, i = 0; cur && i < 5; i++) {
    if ((cur as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

export interface ConnectionServiceDeps {
  db: Db;
  box: SecretBox;
  registry: ProviderRegistry;
}

export function createConnectionService({
  db,
  box,
  registry,
}: ConnectionServiceDeps) {
  async function requireAction(
    actorId: string,
    workspaceId: string,
    action: "connections.manage" | "inbox.read",
  ) {
    const role = await getRole(db, workspaceId, actorId);
    if (!can(role, action)) throw new ForbiddenError();
  }

  return {
    async create(input: {
      actorId: string;
      workspaceId: string;
      provider: string;
      label: string;
      credentials: string;
    }): Promise<ConnectionView> {
      await requireAction(
        input.actorId,
        input.workspaceId,
        "connections.manage",
      );
      if (!registry.get(input.provider))
        throw new ValidationError("Nguồn dữ liệu không tồn tại");
      // NFC ở biên trước khi lưu (BASE-DATA-002) để nhãn "Café" hai cách gõ không thành hai bản ghi.
      const label = input.label.normalize("NFC").trim();
      if (label === "") throw new ValidationError("Nhãn không được rỗng");
      if (input.credentials.trim() === "")
        throw new ValidationError("Khoá không được rỗng");
      try {
        const [row] = await db
          .insert(providerConnections)
          .values({
            workspaceId: input.workspaceId,
            provider: input.provider,
            label,
            credentialsEnc: box.encrypt(input.credentials),
          })
          .returning();
        return view(row!);
      } catch (e) {
        if (isUniqueViolation(e)) {
          throw new ConflictError(
            "duplicate_label",
            "Đã có kết nối cùng nguồn và nhãn này",
          );
        }
        throw e;
      }
    },

    async list(input: {
      actorId: string;
      workspaceId: string;
    }): Promise<ConnectionView[]> {
      await requireAction(input.actorId, input.workspaceId, "inbox.read");
      const rows = await db
        .select()
        .from(providerConnections)
        .where(eq(providerConnections.workspaceId, input.workspaceId))
        .orderBy(asc(providerConnections.createdAt));
      return rows.map(view);
    },

    async remove(input: {
      actorId: string;
      workspaceId: string;
      connectionId: string;
    }): Promise<void> {
      await requireAction(
        input.actorId,
        input.workspaceId,
        "connections.manage",
      );
      if (!UUID.test(input.connectionId)) throw new NotFoundError();
      const deleted = await db
        .delete(providerConnections)
        .where(
          and(
            eq(providerConnections.id, input.connectionId),
            eq(providerConnections.workspaceId, input.workspaceId),
          ),
        )
        .returning({ id: providerConnections.id });
      if (deleted.length === 0) throw new NotFoundError();
    },

    /** Dùng nội bộ ở server để gọi provider; không bao giờ đưa ra API/UI. Ràng buộc đúng workspace. */
    async credentialsFor(input: {
      workspaceId: string;
      connectionId: string;
    }): Promise<string> {
      if (!UUID.test(input.connectionId)) throw new NotFoundError();
      const [row] = await db
        .select({ enc: providerConnections.credentialsEnc })
        .from(providerConnections)
        .where(
          and(
            eq(providerConnections.id, input.connectionId),
            eq(providerConnections.workspaceId, input.workspaceId),
          ),
        );
      if (!row) throw new NotFoundError();
      return box.decrypt(row.enc);
    },
  };
}

export type ConnectionService = ReturnType<typeof createConnectionService>;
