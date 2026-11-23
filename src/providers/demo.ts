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
    async listConversations({ platform, cursor }) {
      if (cursor !== undefined) return { items: [], nextCursor: null };
      return {
        items: [
          {
            id: `demo-${platform}-conv-1`,
            participantId: "demo-customer-1",
            participantName: "Khách demo",
            lastMessageAt: now().toISOString(),
          },
        ],
        nextCursor: null,
      };
    },
    /** Demo "gửi" thành công không đi đâu cả: chỉ trả id giả để chạy thử luồng; KHÔNG gửi tới người thật. */
    async sendMessage() {
      seq += 1;
      return { messageIds: [`demo-sent-${seq}`] };
    },
    async listMessages({ platform, cursor }) {
      if (cursor !== undefined) return { items: [], nextCursor: null };
      const at = now().getTime();
      // Mới nhất trước, như nhà cung cấp thật.
      return {
        items: [
          {
            id: `demo-${platform}-msg-2`,
            identityWeak: false,
            providerMessageId: `demo-${platform}-msg-2`,
            direction: "outgoing",
            author: "Shop",
            text: "Dạ còn ạ.",
            sentAt: new Date(at).toISOString(),
          },
          {
            id: `demo-${platform}-msg-1`,
            identityWeak: false,
            providerMessageId: `demo-${platform}-msg-1`,
            direction: "incoming",
            author: "Khách demo",
            text: SAMPLE_TEXT.dm,
            sentAt: new Date(at - 60_000).toISOString(),
          },
        ],
        nextCursor: null,
      };
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
