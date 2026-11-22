import type { SocialProvider } from "./types";

/**
 * SocialAPI (api.social-api.ai). Ma trận khả năng theo
 * https://docs.social-api.ai/platforms/overview, xem ngày 2026-11-22.
 * "Một phần/có điều kiện" của nguồn được tính là hỗ trợ; khả năng thật của từng bình luận/tài khoản
 * do API trả về lúc chạy (`capabilities`), không suy ra từ bảng này.
 */
export const socialApiProvider: SocialProvider = {
  id: "socialapi",
  label: "SocialAPI",
  support: {
    instagram: ["publish", "dm", "comments", "mentions", "analytics"],
    facebook: ["publish", "dm", "comments", "mentions", "analytics"],
    threads: ["publish", "comments", "mentions", "analytics"],
    google: ["publish", "reviews", "analytics"],
    tiktok: ["publish", "comments", "mentions", "analytics"],
    linkedin: ["publish", "comments", "mentions", "analytics"],
    twitter: ["publish", "dm", "comments", "mentions", "analytics"],
    telegram: ["dm"],
    whatsapp: ["dm"],
    zalo: ["publish", "dm", "analytics"],
    bluesky: ["publish", "dm", "comments", "mentions", "analytics"],
    pinterest: ["publish", "analytics"],
    youtube: ["publish", "comments", "analytics"],
    app_store_connect: ["reviews"],
  },
};
