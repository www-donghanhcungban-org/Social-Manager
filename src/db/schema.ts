import { sql } from "drizzle-orm";
import {
  boolean,
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

/** Trần số ngày lưu tin cấu hình được (~100 năm); muốn giữ mãi thì bật `retain_inbox_forever`. */
export const MAX_RETENTION_DAYS = 36_500;

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Số ngày lưu tin hộp thư/tin nhắn của workspace (D-010); null = mặc định 365 ngày. */
    inboxRetentionDays: integer("inbox_retention_days"),
    /** Owner chọn giữ tin vô thời hạn (cần căn cứ pháp lý riêng, PROJECT.md §5). */
    retainInboxForever: boolean("retain_inbox_forever")
      .notNull()
      .default(false),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "workspaces_retention_days_check",
      sql`${t.inboxRetentionDays} is null or ${t.inboxRetentionDays} between 1 and ${sql.raw(String(MAX_RETENTION_DAYS))}`,
    ),
  ],
);

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
    /** Secret ký webhook của nhà cung cấp (mã hoá như khoá API); null = chưa bật nhận webhook. */
    webhookSecretEnc: text("webhook_secret_enc"),
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

export const INBOX_KINDS = ["dm", "comment", "review", "mention"] as const;
export const INBOX_STATUSES = ["open", "handled"] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];

/**
 * Hộp thư hợp nhất: mỗi dòng là một tin nhắn/bình luận/đánh giá/lượt nhắc đã nhập từ provider.
 * Khoá duy nhất theo (tài khoản, loại, id bên provider) để đồng bộ lặp lại không tạo bản trùng.
 */
export const inboxItems = pgTable(
  "inbox_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    socialAccountId: uuid("social_account_id")
      .notNull()
      .references(() => socialAccounts.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: INBOX_KINDS }).notNull(),
    /** Id của mục bên provider. */
    externalId: text("external_id").notNull(),
    author: text("author").notNull(),
    text: text("text").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    status: text("status", { enum: INBOX_STATUSES }).notNull().default("open"),
    handledBy: text("handled_by"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("inbox_items_account_kind_external").on(
      t.socialAccountId,
      t.kind,
      t.externalId,
    ),
    check("inbox_items_kind_check", sql`${t.kind} in (${inList(INBOX_KINDS)})`),
    check(
      "inbox_items_status_check",
      sql`${t.status} in (${inList(INBOX_STATUSES)})`,
    ),
    index("inbox_items_list_idx").on(
      t.workspaceId,
      t.status,
      t.receivedAt,
      t.id,
    ),
  ],
);

/**
 * Hội thoại tin nhắn riêng (ADR-0002, H1). Một hội thoại có nhiều tin; mốc đồng bộ nằm ở đây để đồng bộ tăng dần và
 * tiếp tục lấy lịch sử cũ qua nhiều lượt (backfill) mà không bỏ sót tin mới của hội thoại cũ.
 */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    socialAccountId: uuid("social_account_id")
      .notNull()
      .references(() => socialAccounts.id, { onDelete: "cascade" }),
    /** Id hội thoại bên nhà cung cấp. */
    externalId: text("external_id").notNull(),
    participantId: text("participant_id").notNull(),
    participantName: text("participant_name").notNull(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    /** Mọi tin gửi tới thời điểm này đã được lấy về (đồng bộ tăng dần dừng ở đây). */
    syncedThrough: timestamp("synced_through", { withTimezone: true }),
    /** Còn lịch sử cũ chưa lấy: cursor của nhà cung cấp để lượt sau đọc tiếp. */
    backfillCursor: text("backfill_cursor"),
    /** Lấy lịch sử cũ tới mốc này thì dừng (null = tới đầu hội thoại). */
    backfillUntil: timestamp("backfill_until", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("conversations_account_external").on(
      t.socialAccountId,
      t.externalId,
    ),
    index("conversations_workspace_idx").on(t.workspaceId),
  ],
);

export const MESSAGE_DIRECTIONS = ["incoming", "outgoing"] as const;

/**
 * Tin nhắn, lưu nguyên văn (không cắt). Khoá khử trùng (tài khoản, external_id) với external_id là id của nền tảng
 * (`platform_id`) khi có để đồng bộ và webhook cùng khớp một tin; `identity_weak` = chỉ có id của nhà cung cấp.
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    socialAccountId: uuid("social_account_id")
      .notNull()
      .references(() => socialAccounts.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    identityWeak: boolean("identity_weak").notNull().default(false),
    providerMessageId: text("provider_message_id"),
    direction: text("direction", { enum: MESSAGE_DIRECTIONS }).notNull(),
    author: text("author").notNull(),
    text: text("text").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    /** Lúc hệ thống ghi nhận tin (khác `sent_at`: lúc tin được gửi). */
    createdAt: createdAt(),
  },
  (t) => [
    unique("messages_account_external").on(t.socialAccountId, t.externalId),
    check(
      "messages_direction_check",
      sql`${t.direction} in (${inList(MESSAGE_DIRECTIONS)})`,
    ),
    index("messages_conversation_sent_idx").on(t.conversationId, t.sentAt),
    index("messages_sent_idx").on(t.sentAt),
    index("messages_workspace_idx").on(t.workspaceId),
  ],
);

/**
 * `submitted`: nhà cung cấp đã nhận, chờ xác nhận · `partial`: lên được một phần đích · `send_unknown`: không biết
 * đã lên mạng chưa (mất kết nối giữa chừng, quá hạn xác nhận) — không tự đăng lại để tránh đăng hai lần (ADR-0002, H2).
 */
export const EVIDENCE_SOURCES = ["message", "document", "github"] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];
export const EVIDENCE_CONTENT_TYPES = [
  "text/plain",
  "text/markdown",
  "application/json",
] as const;
export type EvidenceContentType = (typeof EVIDENCE_CONTENT_TYPES)[number];

/**
 * Kho bản gốc theo hash (ADR-0004, M04). Nội dung nằm ở `BlobStore` (thư mục volume theo `sha256`); bảng này giữ
 * metadata. Duy nhất theo (workspace, sha256): nội dung giống nhau trong một workspace chỉ có một blob, nhưng hai
 * workspace luôn có hai dòng riêng — quyền đọc theo workspace, không theo hash.
 */
export const evidenceBlobs = pgTable(
  "evidence_blobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sha256: text("sha256").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    contentType: text("content_type", {
      enum: EVIDENCE_CONTENT_TYPES,
    }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("evidence_blobs_ws_sha").on(t.workspaceId, t.sha256),
    check("evidence_blobs_sha_check", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check("evidence_blobs_size_check", sql`${t.sizeBytes} > 0`),
    check(
      "evidence_blobs_type_check",
      sql`${t.contentType} in (${inList(EVIDENCE_CONTENT_TYPES)})`,
    ),
  ],
);

/**
 * Mỗi lần một nguồn đưa nội dung vào kho. Cùng (nguồn, id ngoài, blob) nhập lại là một lần (lũy đẳng); cùng id ngoài
 * mà nội dung đổi là phiên bản mới (blob khác); cùng nội dung ở id ngoài khác là lần xuất hiện khác của cùng blob.
 */
export const evidenceItems = pgTable(
  "evidence_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    blobId: uuid("blob_id")
      .notNull()
      .references(() => evidenceBlobs.id, { onDelete: "cascade" }),
    /**
     * Với nguồn `message`: tin nhắn gốc. Xoá tin (hết hạn lưu, xoá tài khoản/hội thoại) xoá luôn bản sao này — bản sao
     * không được sống lâu hơn tin (H5, Luật 91/2025).
     */
    messageId: uuid("message_id").references(() => messages.id, {
      onDelete: "cascade",
    }),
    source: text("source", { enum: EVIDENCE_SOURCES }).notNull(),
    /** Id của mục bên nguồn (vd id tin nhắn, `owner/repo#12`, đường dẫn tài liệu). */
    externalId: text("external_id").notNull(),
    /** Lúc nội dung xảy ra/được tạo ở nguồn (không phải lúc nhập). */
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("evidence_items_source_external_blob").on(
      t.workspaceId,
      t.source,
      t.externalId,
      t.blobId,
    ),
    check(
      "evidence_items_source_check",
      sql`${t.source} in (${inList(EVIDENCE_SOURCES)})`,
    ),
    check(
      "evidence_items_external_check",
      sql`length(${t.externalId}) between 1 and 500`,
    ),
    check(
      "evidence_items_message_check",
      sql`(${t.source} = 'message') = (${t.messageId} is not null)`,
    ),
    index("evidence_items_blob_idx").on(t.blobId),
    index("evidence_items_message_idx").on(t.messageId),
    index("evidence_items_ws_observed_idx").on(t.workspaceId, t.observedAt),
  ],
);

export const POST_STATUSES = [
  "scheduled",
  "publishing",
  "submitted",
  "published",
  "partial",
  "failed",
  "send_unknown",
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
    index("posts_social_account_idx").on(t.socialAccountId),
  ],
);

/**
 * Đếm đăng nhập thất bại liên tiếp theo email đã chuẩn hoá (BE-AUTH-003), kể cả email chưa đăng ký để
 * phản hồi không lộ tài khoản nào tồn tại. Lưu băm của email (không lưu email rõ).
 */
export const loginThrottle = pgTable(
  "login_throttle",
  {
    keyHash: text("key_hash").primaryKey(),
    failures: integer("failures").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [check("login_throttle_failures_check", sql`${t.failures} >= 0`)],
);
