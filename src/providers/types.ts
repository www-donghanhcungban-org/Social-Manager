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
  status: "published" | "scheduled";
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
  publishPost?(input: PublishInput): Promise<PublishResult>;
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

/** Đầu vào sai; người gọi sửa được. */
export class ValidationError extends Error {
  readonly code = "validation";
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
