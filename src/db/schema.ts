import { sql } from "drizzle-orm";
import {
  check,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { PLATFORMS } from "../providers/types";

export const ROLES = ["owner", "admin", "member"] as const;
export type Role = (typeof ROLES)[number];

/** Danh sách hằng số của mã (không phải đầu vào người dùng) nên nối thẳng vào CHECK là an toàn. */
const inList = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v}'`).join(", "));

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const members = pgTable(
  "members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Id người dùng của Better Auth (bảng người dùng thêm ở migration đăng nhập). */
    userId: text("user_id").notNull(),
    role: text("role", { enum: ROLES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    check("members_role_check", sql`${t.role} in (${inList(ROLES)})`),
  ],
);

export const providerConnections = pgTable(
  "provider_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Id provider trong registry (`socialapi`, `demo`…). */
    provider: text("provider").notNull(),
    label: text("label").notNull(),
    /** Đầu ra của `SecretBox.encrypt`; không bao giờ lưu khoá ở dạng rõ. */
    credentialsEnc: text("credentials_enc").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("provider_connections_ws_provider_label").on(
      t.workspaceId,
      t.provider,
      t.label,
    ),
  ],
);

/**
 * Tài khoản mạng xã hội thuộc một kết nối. Không có cột workspace riêng: workspace suy ra từ kết nối,
 * để không thể có tài khoản lệch workspace với kết nối của nó.
 */
export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => providerConnections.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    /** Id tài khoản bên provider. */
    externalId: text("external_id").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("social_accounts_conn_platform_external").on(
      t.connectionId,
      t.platform,
      t.externalId,
    ),
    check(
      "social_accounts_platform_check",
      sql`${t.platform} in (${inList(PLATFORMS)})`,
    ),
  ],
);
