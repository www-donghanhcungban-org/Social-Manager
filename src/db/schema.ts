import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { PLATFORMS } from "../providers/types";

export * from "./auth-schema";

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
    // DEBT: user_id chưa có khoá ngoại tới user.id | trần: xoá tài khoản để lại thành viên mồ côi |
    // xem lại khi: làm chức năng xoá tài khoản (thêm FK ON DELETE CASCADE kèm dọn dữ liệu cũ)
    /** Id người dùng của Better Auth (`user.id`). */
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

export const POST_STATUSES = [
  "scheduled",
  "publishing",
  "published",
  "failed",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/**
 * Bài đăng (đăng ngay hoặc hẹn giờ). Mọi thời điểm là `timestamptz` (UTC). `idempotency_key` do client
 * gửi để gửi lại cùng yêu cầu không tạo bài thứ hai (BASE-DATA-008).
 */
export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    socialAccountId: uuid("social_account_id")
      .notNull()
      .references(() => socialAccounts.id, { onDelete: "cascade" }),
    createdBy: text("created_by").notNull(),
    text: text("text").notNull(),
    status: text("status", { enum: POST_STATUSES }).notNull(),
    /** Giờ hẹn; luôn có (đăng ngay = giờ tạo) để một hàng đợi duy nhất xử lý cả hai loại. */
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    /** Lúc worker nhận bài (chuyển sang publishing); dùng để phát hiện bài kẹt. */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    externalId: text("external_id"),
    /** Mã lỗi ngắn, không chứa nội dung phía nhà cung cấp. */
    errorCode: text("error_code"),
    attempts: integer("attempts").notNull().default(0),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("posts_ws_idempotency").on(t.workspaceId, t.idempotencyKey),
    check("posts_status_check", sql`${t.status} in (${inList(POST_STATUSES)})`),
    check("posts_attempts_check", sql`${t.attempts} >= 0`),
    check("posts_text_check", sql`length(btrim(${t.text})) > 0`),
    index("posts_due_idx").on(t.status, t.scheduledAt),
  ],
);
