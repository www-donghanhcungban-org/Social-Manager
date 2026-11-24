/** Nền tảng mạng xã hội mà app biết (khớp slug của SocialAPI để đổi nhà cung cấp không phải đổi dữ liệu). */
export const PLATFORMS = [
  "facebook",
  "instagram",
  "threads",
  "tiktok",
  "linkedin",
  "twitter",
  "youtube",
  "pinterest",
  "google",
  "zalo",
  "whatsapp",
  "telegram",
  "bluesky",
  "app_store_connect",
] as const;
export type Platform = (typeof PLATFORMS)[number];

/** Việc app có thể nhờ một nhà cung cấp làm trên một nền tảng. */
export const CAPABILITIES = [
  "publish",
  "dm",
  "comments",
  "reviews",
  "mentions",
  "analytics",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Loại mục trong hộp thư hợp nhất, mỗi loại ứng với một khả năng của provider. */
export type InboxKind = "dm" | "comment" | "review" | "mention";

export interface InboxItem {
  id: string;
  platform: Platform;
  kind: InboxKind;
  author: string;
  text: string;
  /** ISO 8601 UTC (`Date.toISOString()`). */
  receivedAt: string;
}

/** Một trang kết quả; `nextCursor` null = trang cuối. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Hội thoại tin nhắn riêng bên nhà cung cấp (khác tin nhắn: một hội thoại có nhiều tin). */
export interface ConversationSummary {
  /** Id hội thoại bên nhà cung cấp. */
  id: string;
  participantId: string;
  participantName: string;
  /** ISO 8601 có múi giờ; null khi nhà cung cấp chưa có tin nào. */
  lastMessageAt: string | null;
}

export const MESSAGE_DIRECTIONS = ["incoming", "outgoing"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export interface ProviderMessage {
  /**
   * Định danh ổn định của tin để khử trùng giữa đồng bộ và webhook: id của nền tảng (`platform_id`) khi có, nếu không
   * thì id của nhà cung cấp và `identityWeak = true` (cùng một tin có thể mang id khác ở webhook).
   */
  id: string;
  identityWeak: boolean;
  /** Id tin theo nhà cung cấp (vd UUID của SocialAPI). */
  providerMessageId: string;
  direction: MessageDirection;
  author: string;
  /** Nội dung gốc, không cắt. */
  text: string;
  /** ISO 8601 có múi giờ. */
  sentAt: string;
}

export interface ConversationQuery {
  platform: Platform;
  accountId: string;
  cursor?: string;
}

export interface MessageQuery extends ConversationQuery {
  conversationId: string;
}

export interface InboxQuery {
  platform: Platform;
  accountId: string;
  kind: InboxKind;
}

export interface PublishInput {
  platform: Platform;
  accountId: string;
  text: string;
  /** ISO 8601; vắng = đăng ngay. */
  scheduledAt?: string;
}

export interface PublishResult {
  id: string;
  /**
   * `published`: đã lên mạng · `scheduled`: nhà cung cấp giữ để đăng theo giờ hẹn · `submitted`: đã nhận nhưng chưa
   * biết kết quả cuối (vd SocialAPI `publishing`) — phải xác nhận lại bằng `getPostStatus` (ADR-0002, H2).
   */
  status: "published" | "scheduled" | "submitted";
}

/** Trạng thái cuối/hiện tại của bài phía nhà cung cấp; `pending` = chưa xong. */
export const REMOTE_POST_STATUSES = [
  "pending",
  "published",
  "partial",
  "failed",
  "cancelled",
] as const;
export type RemotePostStatus = (typeof REMOTE_POST_STATUSES)[number];

/** Gửi một tin trả lời vào hội thoại có sẵn. Người nhận do hội thoại quyết định — không có trường "người nhận" tự do. */
export interface SendMessageInput {
  platform: Platform;
  /** Id tài khoản bên nhà cung cấp (`social_accounts.external_id`). */
  accountId: string;
  /** Id hội thoại bên nhà cung cấp (`conversations.external_id`). */
  conversationId: string;
  text: string;
}

export interface SendMessageResult {
  /** Id tin do nhà cung cấp cấp; có thể rỗng (Zalo trả chuỗi rỗng). */
  messageIds: string[];
}

/**
 * Nhà cung cấp TỪ CHỐI gửi một cách chắc chắn (vd 4xx, hết cửa sổ nhắn tin): tin chưa được gửi, hành động là `failed` hoặc
 * `blocked`. Mọi lỗi KHÁC khi gửi (hết giờ, mất kết nối, 5xx, phản hồi đọc không được) là KHÔNG CHẮC — tin có thể đã
 * đi — và phải thành `send_unknown`, không bao giờ thử lại mù (H3).
 */
export class SendRejectedError extends Error {
  readonly name = "SendRejectedError";
  constructor(
    /** Mã ngắn an toàn (không chứa nội dung phía nhà cung cấp). */
    readonly code: string,
    readonly reason: "window_closed" | "rejected",
  ) {
    super(`Nhà cung cấp từ chối gửi (${code})`);
  }
}

export interface PostStatusQuery {
  platform: Platform;
  accountId: string;
  /** Id bài bên nhà cung cấp (`PublishResult.id`). */
  postId: string;
}

/**
 * Nguồn dữ liệu mạng xã hội cắm được (SocialAPI, chế độ demo, API trực tiếp của nền tảng…).
 * Hành động là tuỳ chọn ở kiểu nhưng provider khai `support` thì phải cài đặt hành động tương ứng
 * (bộ hợp đồng `tests/providers/actions.test.ts` kiểm trên mọi provider đã đăng ký).
 * Gọi qua `src/providers/actions.ts`, không gọi trực tiếp, để luôn qua kiểm tra hỗ trợ + đầu vào.
 */
export interface SocialProvider {
  readonly id: string;
  readonly label: string;
  /** Nền tảng nào làm được việc gì; nền tảng vắng mặt = không hỗ trợ. */
  readonly support: Partial<Record<Platform, readonly Capability[]>>;
  listInbox?(query: InboxQuery): Promise<InboxItem[]>;
  /** Hội thoại DM, hoạt động gần nhất trước. Khai `dm` mà có hàm này thì đồng bộ đọc theo hội thoại + tin nhắn. */
  listConversations?(
    query: ConversationQuery,
  ): Promise<Page<ConversationSummary>>;
  /** Tin nhắn của một hội thoại, mới nhất trước. Cài cùng `listConversations`. */
  listMessages?(query: MessageQuery): Promise<Page<ProviderMessage>>;
  publishPost?(input: PublishInput): Promise<PublishResult>;
  /** Gửi tin trả lời vào hội thoại. Không có idempotency phía nhà cung cấp: gọi lại có thể tạo tin trùng. */
  sendMessage?(input: SendMessageInput): Promise<SendMessageResult>;
  /** Đọc lại trạng thái bài đã gửi. Provider có thể trả `submitted` thì phải cài hàm này. */
  getPostStatus?(query: PostStatusQuery): Promise<{ status: RemotePostStatus }>;
}

/** Provider không làm được việc này trên nền tảng này (hoặc khai hỗ trợ mà chưa cài đặt). */
export class UnsupportedError extends Error {
  constructor(
    readonly platform: Platform,
    readonly capability: Capability,
    readonly code: "unsupported" | "not_implemented" = "unsupported",
  ) {
    super(`Không hỗ trợ ${capability} trên ${platform} (${code})`);
    this.name = "UnsupportedError";
  }
}

// `ValidationError` là lỗi miền dùng chung, sống ở auth/errors; re-export để import cũ không vỡ.
export { ValidationError } from "../auth/errors";
