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
  uniqueIndex,
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
    /**
     * Cho phép gửi trích đoạn tới AI ở điểm cuối KHÔNG phải máy cục bộ (chuyển dữ liệu ra ngoài, H6). Mặc định tắt; chỉ
     * owner bật. AI cục bộ không cần cờ này.
     */
    aiCloudEnabled: boolean("ai_cloud_enabled").notNull().default(false),
    /**
     * Cho phép gửi tin trả lời từ hộp thư (chính sách hành động, M09). Mặc định TẮT; chỉ owner bật. Gửi thật còn cần cờ hệ
     * thống `OUTBOUND_LIVE` (hai khoá độc lập).
     */
    outboundEnabled: boolean("outbound_enabled").notNull().default(false),
    /** Hạn mức hành động gửi mỗi giờ của workspace (0 = chặn hết). */
    outboundMaxPerHour: integer("outbound_max_per_hour").notNull().default(10),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "workspaces_outbound_max_check",
      sql`${t.outboundMaxPerHour} between 0 and 1000`,
    ),
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
/**
 * Mốc đồng bộ của một tài khoản: lần chạy cuối, lần thành công cuối, số lần lỗi liên tiếp và mã lỗi an toàn gần nhất.
 * Cho biết nguồn đã được lấy tới đâu để không nhầm "chưa thấy tin" với "chưa đồng bộ được".
 */
export const sourceCheckpoints = pgTable(
  "source_checkpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    socialAccountId: uuid("social_account_id")
      .notNull()
      .references(() => socialAccounts.id, { onDelete: "cascade" }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }).notNull(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    /** Mã ngắn, không chứa nội dung phía nhà cung cấp. */
    lastErrorCode: text("last_error_code"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("source_checkpoints_account").on(t.socialAccountId),
    check(
      "source_checkpoints_failures_check",
      sql`${t.consecutiveFailures} >= 0`,
    ),
    check(
      "source_checkpoints_code_check",
      sql`${t.lastErrorCode} is null or ${t.lastErrorCode} ~ '^[A-Za-z0-9_.-]{1,64}$'`,
    ),
    index("source_checkpoints_workspace_idx").on(t.workspaceId),
  ],
);

/**
 * Con trỏ nhập của một connector theo phạm vi (vd `github` + `owner/repo`): `cursor` là mốc `updated_at` đã xử lý tới
 * đâu, để lượt sau chỉ lấy phần mới. Khác `source_checkpoints` (theo tài khoản mạng xã hội).
 */
export const connectorCursors = pgTable(
  "connector_cursors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    connector: text("connector").notNull(),
    scope: text("scope").notNull(),
    cursor: text("cursor"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }).notNull(),
    /** Mã ngắn, không chứa nội dung phía nguồn. */
    lastErrorCode: text("last_error_code"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("connector_cursors_scope").on(t.workspaceId, t.connector, t.scope),
    check(
      "connector_cursors_code_check",
      sql`${t.lastErrorCode} is null or ${t.lastErrorCode} ~ '^[A-Za-z0-9_.-]{1,64}$'`,
    ),
  ],
);

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

export const PROJECT_LINK_TARGETS = ["conversation", "evidence"] as const;
export type ProjectLinkTarget = (typeof PROJECT_LINK_TARGETS)[number];

/** Khoá so khớp tên/bí danh: NFC + bỏ khoảng thừa + không phân biệt hoa thường (BASE-DATA-002). */
export const nameKeyOf = (s: string) =>
  s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

/** Dự án: nhóm các nguồn (hội thoại, bằng chứng) thành một ngữ cảnh làm việc (M06). */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** `nameKeyOf(name)`: duy nhất trong workspace. */
    nameKey: text("name_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("projects_ws_name_key").on(t.workspaceId, t.nameKey),
    check(
      "projects_name_check",
      sql`length(btrim(${t.name})) between 1 and 100`,
    ),
  ],
);

/** Bí danh của dự án (tên viết tắt, tên khách gọi…). Duy nhất trong workspace để một bí danh chỉ trỏ một dự án. */
export const projectAliases = pgTable(
  "project_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    aliasKey: text("alias_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("project_aliases_ws_key").on(t.workspaceId, t.aliasKey),
    check(
      "project_aliases_alias_check",
      sql`length(btrim(${t.alias})) between 1 and 100`,
    ),
    index("project_aliases_project_idx").on(t.projectId),
  ],
);

/**
 * Liên kết nguồn–dự án: gắn một hội thoại hoặc một bằng chứng vào dự án. Gỡ liên kết không xoá nguồn; xoá nguồn
 * (hết hạn lưu, xoá tài khoản) xoá liên kết theo tầng.
 */
export const projectLinks = pgTable(
  "project_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    targetType: text("target_type", { enum: PROJECT_LINK_TARGETS }).notNull(),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "cascade",
    }),
    evidenceItemId: uuid("evidence_item_id").references(
      () => evidenceItems.id,
      { onDelete: "cascade" },
    ),
    /** Người gắn (`user.id` của Better Auth). */
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("project_links_conversation").on(t.projectId, t.conversationId),
    unique("project_links_evidence").on(t.projectId, t.evidenceItemId),
    check(
      "project_links_target_check",
      sql`(${t.targetType} = 'conversation' and ${t.conversationId} is not null and ${t.evidenceItemId} is null)
        or (${t.targetType} = 'evidence' and ${t.evidenceItemId} is not null and ${t.conversationId} is null)`,
    ),
    index("project_links_workspace_idx").on(t.workspaceId),
    index("project_links_conversation_idx").on(t.conversationId),
    index("project_links_evidence_idx").on(t.evidenceItemId),
  ],
);

/**
 * Chỉ mục tìm kiếm toàn văn của một bằng chứng (H8): nội dung đã bỏ dấu bằng `src/search/fold.ts`, tìm bằng
 * `to_tsvector('simple', …)` (chỉ mục GIN). Ghi cùng giao dịch với lần nhập; xoá bằng chứng xoá theo tầng.
 */
export const searchDocuments = pgTable(
  "search_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    evidenceItemId: uuid("evidence_item_id")
      .notNull()
      .references(() => evidenceItems.id, { onDelete: "cascade" }),
    textFolded: text("text_folded").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("search_documents_item").on(t.evidenceItemId),
    index("search_documents_fts_idx").using(
      "gin",
      sql`to_tsvector('simple', ${t.textFolded})`,
    ),
    index("search_documents_workspace_idx").on(t.workspaceId),
  ],
);

export const DECISION_STATUSES = ["active", "superseded"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

/**
 * Sổ quyết định của dự án: mỗi quyết định dẫn MỘT bằng chứng làm nguồn. Quyết định mới có thể thay quyết định cũ (cái cũ
 * thành `superseded`, không xoá). Xoá bằng chứng nguồn không xoá quyết định: khoá ngoại `SET NULL` và `source_label`
 * giữ lại tên nguồn để biết đã mất nguồn nào.
 */
export const decisions = pgTable(
  "decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    status: text("status", { enum: DECISION_STATUSES })
      .notNull()
      .default("active"),
    /** Lúc quyết định được đưa ra (không phải lúc ghi sổ). */
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
    sourceEvidenceItemId: uuid("source_evidence_item_id").references(
      () => evidenceItems.id,
      { onDelete: "set null" },
    ),
    /** `id ngoài` của nguồn lúc ghi sổ, để còn dấu vết khi bằng chứng bị xoá. */
    sourceLabel: text("source_label").notNull(),
    supersededById: uuid("superseded_by_id"),
    /** Người ghi sổ (`user.id` của Better Auth). */
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "decisions_status_check",
      sql`${t.status} in (${inList(DECISION_STATUSES)})`,
    ),
    check(
      "decisions_text_check",
      sql`length(btrim(${t.text})) between 1 and 2000`,
    ),
    index("decisions_project_idx").on(t.projectId, t.decidedAt),
    index("decisions_workspace_idx").on(t.workspaceId),
    index("decisions_source_idx").on(t.sourceEvidenceItemId),
  ],
);

export const AI_DISCLOSURE_STATUSES = [
  "sent",
  "ok",
  "error",
  "blocked",
] as const;
export type AiDisclosureStatus = (typeof AI_DISCLOSURE_STATUSES)[number];

/**
 * Nhật ký dữ liệu gửi tới AI (H6, H11): mỗi lượt gọi một dòng — điểm cuối, mô hình, số mục và số byte đã gửi. KHÔNG lưu
 * nội dung đã gửi hay câu trả lời. Ghi TRƯỚC khi gửi (không ghi được thì không gửi).
 */
export const aiDisclosures = pgTable(
  "ai_disclosures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Người dùng gây ra lượt gọi (`user.id` của Better Auth). */
    actorId: text("actor_id").notNull(),
    purpose: text("purpose").notNull(),
    endpointHost: text("endpoint_host").notNull(),
    model: text("model").notNull(),
    local: boolean("local").notNull(),
    itemCount: integer("item_count").notNull(),
    bytesSent: integer("bytes_sent").notNull(),
    status: text("status", { enum: AI_DISCLOSURE_STATUSES }).notNull(),
    /** Mã ngắn, không chứa nội dung. */
    errorCode: text("error_code"),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "ai_disclosures_status_check",
      sql`${t.status} in (${inList(AI_DISCLOSURE_STATUSES)})`,
    ),
    check(
      "ai_disclosures_counts_check",
      sql`${t.itemCount} >= 0 and ${t.bytesSent} >= 0`,
    ),
    check(
      "ai_disclosures_code_check",
      sql`${t.errorCode} is null or ${t.errorCode} ~ '^[A-Za-z0-9_.-]{1,64}$'`,
    ),
    index("ai_disclosures_ws_created_idx").on(t.workspaceId, t.createdAt),
  ],
);

export const AUDIT_OUTCOMES = ["success", "denied", "error"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

/**
 * Audit trail hành động nhạy cảm (SEC-LOG-007, CMP-AUDIT-002): chỉ ghi thêm. Trigger CSDL từ chối UPDATE/DELETE/TRUNCATE
 * với MỌI vai trò (kể cả chủ bảng) — không dựa vào việc ứng dụng tự giữ kỷ luật. `workspace_id` KHÔNG có khoá ngoại
 * để xoá workspace không xoá dấu vết (và không bị trigger chặn). Không lưu nội dung người dùng: chỉ loại + id đối tượng.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    /** Người làm (`user.id`); `system` cho job. Không tên thật. */
    actorId: text("actor_id").notNull(),
    /** Tên sự kiện dạng `nhóm.hành_động`, vd `workspace.settings_changed`. */
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    outcome: text("outcome", { enum: AUDIT_OUTCOMES }).notNull(),
    /** Lý do/mã ngắn, không chứa dữ liệu cá nhân. */
    reason: text("reason"),
    sourceIp: text("source_ip"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "audit_events_outcome_check",
      sql`${t.outcome} in (${inList(AUDIT_OUTCOMES)})`,
    ),
    check(
      "audit_events_action_check",
      sql`${t.action} ~ '^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$'`,
    ),
    index("audit_events_ws_created_idx").on(t.workspaceId, t.createdAt),
  ],
);

export const DRAFT_STATUSES = ["open", "sent", "discarded"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];
export const DRAFT_SOURCES = ["human", "ai"] as const;
export type DraftSource = (typeof DRAFT_SOURCES)[number];

/**
 * Bản nháp trả lời một hội thoại (M09). Nội dung nằm ở `draft_versions` (mỗi lần sửa một phiên bản, không ghi đè);
 * `current_version` là khoá lạc quan: sửa phải nêu phiên bản đang dựa vào. Xoá hội thoại xoá luôn nháp.
 */
export const drafts = pgTable(
  "drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    status: text("status", { enum: DRAFT_STATUSES }).notNull().default("open"),
    currentVersion: integer("current_version").notNull().default(1),
    /** Người tạo (`user.id` của Better Auth). */
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "drafts_status_check",
      sql`${t.status} in (${inList(DRAFT_STATUSES)})`,
    ),
    check("drafts_version_check", sql`${t.currentVersion} >= 1`),
    index("drafts_conversation_idx").on(t.conversationId, t.updatedAt),
    index("drafts_workspace_idx").on(t.workspaceId),
  ],
);

export const draftVersions = pgTable(
  "draft_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    text: text("text").notNull(),
    /** `ai`: do mô hình gợi ý (người vẫn phải duyệt trước khi gửi); `human`: người gõ. */
    source: text("source", { enum: DRAFT_SOURCES }).notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("draft_versions_draft_version").on(t.draftId, t.version),
    check("draft_versions_version_check", sql`${t.version} >= 1`),
    check(
      "draft_versions_source_check",
      sql`${t.source} in (${inList(DRAFT_SOURCES)})`,
    ),
    check(
      "draft_versions_text_check",
      sql`length(btrim(${t.text})) between 1 and 4000`,
    ),
    index("draft_versions_workspace_idx").on(t.workspaceId),
  ],
);

export const ACTION_KINDS = ["send_message"] as const;
export const ACTION_STATES = [
  "queued",
  "dispatching",
  "confirmed",
  "send_unknown",
  "blocked",
  "failed",
  "cancel_requested",
  "cancelled",
] as const;
export type ActionState = (typeof ACTION_STATES)[number];

/**
 * Sổ hành động (H3, H14): mỗi lần hệ thống định gửi một tin ra ngoài là một dòng, bền, KHÔNG phụ thuộc vào job. Job chỉ mang
 * `action_id`. Không lưu nội dung tin (chỉ băm); nội dung nằm ở phiên bản nháp bất biến mà hành động trỏ tới.
 */
export const actionLedger = pgTable(
  "action_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ACTION_KINDS })
      .notNull()
      .default("send_message"),
    state: text("state", { enum: ACTION_STATES }).notNull(),
    draftId: uuid("draft_id").references(() => drafts.id, {
      onDelete: "set null",
    }),
    draftVersion: integer("draft_version").notNull(),
    /** Hội thoại đích; null khi hội thoại đã bị xoá (sổ vẫn giữ để đối soát). */
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    /** Id hội thoại bên nhà cung cấp, ghi lúc yêu cầu để còn dấu vết khi hội thoại bị xoá. */
    recipientRef: text("recipient_ref").notNull(),
    /** sha256 của nội dung (NFC, đã trim) — đối soát không cần giữ nội dung. */
    textHash: text("text_hash").notNull(),
    textBytes: integer("text_bytes").notNull(),
    /** Khoá lũy đẳng do người gọi cấp: gửi lại cùng khoá không tạo hành động thứ hai. */
    idempotencyKey: text("idempotency_key").notNull(),
    blockedReason: text("blocked_reason"),
    /** Mã ngắn an toàn của lỗi/kết quả đối soát. */
    errorCode: text("error_code"),
    providerMessageIds: text("provider_message_ids").array(),
    /** Số lần NHẬN VIỆC để gửi; luôn 0 hoặc 1 (CHECK) — không bao giờ gửi lại. */
    attempts: integer("attempts").notNull().default(0),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Lần đối soát gần nhất của `send_unknown` và kết quả (`found`/`not_found`/`error`). */
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    reconcileResult: text("reconcile_result"),
    /** Người quyết định cho `send_unknown` (`resolveUnknown`). */
    resolvedBy: text("resolved_by"),
  },
  (t) => [
    unique("action_ledger_ws_key").on(t.workspaceId, t.idempotencyKey),
    check(
      "action_ledger_state_check",
      sql`${t.state} in (${inList(ACTION_STATES)})`,
    ),
    check(
      "action_ledger_kind_check",
      sql`${t.kind} in (${inList(ACTION_KINDS)})`,
    ),
    check("action_ledger_attempts_check", sql`${t.attempts} between 0 and 1`),
    check("action_ledger_hash_check", sql`${t.textHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "action_ledger_code_check",
      sql`(${t.errorCode} is null or ${t.errorCode} ~ '^[A-Za-z0-9_.-]{1,64}$')
        and (${t.blockedReason} is null or ${t.blockedReason} ~ '^[a-z_]{1,64}$')`,
    ),
    check(
      "action_ledger_blocked_check",
      sql`(${t.state} = 'blocked') = (${t.blockedReason} is not null)`,
    ),
    // Một nháp chỉ có MỘT hành động còn hiệu lực/đã gửi/chưa rõ: chặn hai khoá lũy đẳng khác nhau cùng gửi một nháp.
    uniqueIndex("action_ledger_draft_active")
      .on(t.draftId)
      .where(
        sql`${t.state} in ('queued', 'dispatching', 'cancel_requested', 'send_unknown', 'confirmed')`,
      ),
    index("action_ledger_state_idx").on(t.state, t.createdAt),
    index("action_ledger_ws_created_idx").on(t.workspaceId, t.createdAt),
    index("action_ledger_conversation_idx").on(t.conversationId),
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
