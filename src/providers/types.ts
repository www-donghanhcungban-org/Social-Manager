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

/**
 * Nguồn dữ liệu mạng xã hội cắm được (SocialAPI, chế độ demo, API trực tiếp của nền tảng…).
 * Lát này chỉ khai báo khả năng; các hành động (đăng bài, đọc hộp thư…) thêm theo từng đợt,
 * mỗi hành động kèm test hợp đồng chạy được trên mọi provider.
 */
export interface SocialProvider {
  readonly id: string;
  readonly label: string;
  /** Nền tảng nào làm được việc gì; nền tảng vắng mặt = không hỗ trợ. */
  readonly support: Partial<Record<Platform, readonly Capability[]>>;
}
