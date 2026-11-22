import {
  CAPABILITIES,
  PLATFORMS,
  type InboxKind,
  type SocialProvider,
} from "./types";

const SAMPLE_TEXT: Record<InboxKind, string> = {
  dm: "Shop ơi, còn hàng không?",
  comment: "Giá bao nhiêu vậy ạ?",
  review: "Giao hàng nhanh, đóng gói kỹ.",
  mention: "Mình vừa thử sản phẩm này, rất ổn.",
};

/**
 * Provider chạy thử: khai mọi khả năng trên mọi nền tảng và trả dữ liệu mẫu cố định,
 * để dùng app khi chưa có khoá thật. `now` tiêm được để test không phụ thuộc đồng hồ.
 */
export function createDemoProvider(
  opts: { now?: () => Date } = {},
): SocialProvider {
  const now = opts.now ?? (() => new Date());
  let seq = 0;
  return {
    id: "demo",
    label: "Chế độ demo",
    support: Object.fromEntries(PLATFORMS.map((p) => [p, CAPABILITIES])),
    async listInbox({ platform, kind }) {
      return [
        {
          id: `demo-${platform}-${kind}-1`,
          platform,
          kind,
          author: "Khách demo",
          text: SAMPLE_TEXT[kind],
          receivedAt: now().toISOString(),
        },
      ];
    },
    async publishPost({ scheduledAt }) {
      // Giờ hẹn đã được `actions.publishPost` kiểm (hợp lệ, ở tương lai).
      seq += 1;
      return {
        id: `demo-post-${seq}`,
        status: scheduledAt === undefined ? "published" : "scheduled",
      };
    },
  };
}
