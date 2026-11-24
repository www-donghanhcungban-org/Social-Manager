import {
  REMOTE_POST_STATUSES,
  UnsupportedError,
  ValidationError,
  type Capability,
  type PostStatusQuery,
  type RemotePostStatus,
  type SendMessageInput,
  type SendMessageResult,
  type ConversationQuery,
  type ConversationSummary,
  type InboxItem,
  type MessageQuery,
  type Page,
  type ProviderMessage,
  type InboxKind,
  type InboxQuery,
  type Platform,
  type PublishInput,
  type PublishResult,
  type SocialProvider,
} from "./types";

const KIND_CAPABILITY: Record<InboxKind, Capability> = {
  dm: "dm",
  comment: "comments",
  review: "reviews",
  mention: "mentions",
};

/** Đứng giữa app và provider: kiểm hỗ trợ trước, báo lỗi có mã thay vì trả rỗng giả. */
function requireSupport(
  provider: SocialProvider,
  platform: Platform,
  capability: Capability,
) {
  if (
    !Object.hasOwn(provider.support, platform) ||
    !provider.support[platform]?.includes(capability)
  ) {
    throw new UnsupportedError(platform, capability);
  }
}

export async function listInbox(
  provider: SocialProvider,
  query: InboxQuery,
): Promise<InboxItem[]> {
  const capability = KIND_CAPABILITY[query.kind];
  requireSupport(provider, query.platform, capability);
  if (!provider.listInbox)
    throw new UnsupportedError(query.platform, capability, "not_implemented");
  return provider.listInbox(query);
}

/** Provider có đọc DM theo hội thoại + tin nhắn không (khai `dm` và cài đủ hai hàm). */
export function supportsConversations(
  provider: SocialProvider,
  platform: Platform,
): boolean {
  return (
    Object.hasOwn(provider.support, platform) &&
    provider.support[platform]!.includes("dm") &&
    typeof provider.listConversations === "function" &&
    typeof provider.listMessages === "function"
  );
}

export async function listConversations(
  provider: SocialProvider,
  query: ConversationQuery,
): Promise<Page<ConversationSummary>> {
  requireSupport(provider, query.platform, "dm");
  if (!provider.listConversations || !provider.listMessages)
    throw new UnsupportedError(query.platform, "dm", "not_implemented");
  return provider.listConversations(query);
}

export async function listMessages(
  provider: SocialProvider,
  query: MessageQuery,
): Promise<Page<ProviderMessage>> {
  requireSupport(provider, query.platform, "dm");
  if (!provider.listConversations || !provider.listMessages)
    throw new UnsupportedError(query.platform, "dm", "not_implemented");
  if (query.conversationId === "")
    throw new ValidationError("Thiếu id hội thoại");
  return provider.listMessages(query);
}

/** Provider gửi được tin trả lời không (khai `dm` và cài `sendMessage`). */
export function supportsSend(provider: SocialProvider, platform: Platform) {
  return (
    Object.hasOwn(provider.support, platform) &&
    provider.support[platform]!.includes("dm") &&
    typeof provider.sendMessage === "function"
  );
}

/**
 * Gửi một tin. KHÔNG tự thử lại và không nuốt lỗi: `SendRejectedError` = từ chối chắc chắn, mọi lỗi khác = không chắc
 * (người gọi ghi `send_unknown`). Kiểm đầu vào trước khi chạm mạng.
 */
export async function sendMessage(
  provider: SocialProvider,
  input: SendMessageInput,
): Promise<SendMessageResult> {
  requireSupport(provider, input.platform, "dm");
  if (!provider.sendMessage)
    throw new UnsupportedError(input.platform, "dm", "not_implemented");
  if (input.conversationId === "" || input.accountId === "")
    throw new ValidationError("Thiếu hội thoại hoặc tài khoản");
  if (input.text.trim() === "")
    throw new ValidationError("Nội dung tin không được rỗng");
  return provider.sendMessage(input);
}

/** Đọc lại trạng thái bài đã gửi; provider không cài thì `not_implemented` (bài giữ `submitted` tới hạn). */
export async function getPostStatus(
  provider: SocialProvider,
  query: PostStatusQuery,
): Promise<RemotePostStatus> {
  requireSupport(provider, query.platform, "publish");
  if (!provider.getPostStatus)
    throw new UnsupportedError(query.platform, "publish", "not_implemented");
  if (query.postId === "") throw new ValidationError("Thiếu id bài đăng");
  const { status } = await provider.getPostStatus(query);
  if (!REMOTE_POST_STATUSES.includes(status))
    throw new ValidationError("Trạng thái bài đăng không hợp lệ");
  return status;
}

export async function publishPost(
  provider: SocialProvider,
  input: PublishInput,
  /** Đồng hồ tiêm được để test không phụ thuộc giờ thật. */
  { now = () => new Date() }: { now?: () => Date } = {},
): Promise<PublishResult> {
  requireSupport(provider, input.platform, "publish");
  if (!provider.publishPost) {
    throw new UnsupportedError(input.platform, "publish", "not_implemented");
  }
  if (input.text.trim() === "")
    throw new ValidationError("Nội dung bài đăng không được rỗng");
  if (input.scheduledAt === undefined) return provider.publishPost(input);
  const at = parseIsoWithOffset(input.scheduledAt);
  if (at === undefined) {
    throw new ValidationError(
      "Giờ hẹn phải là ISO 8601 đầy đủ kèm múi giờ (vd 2026-12-01T10:00:00Z)",
    );
  }
  if (at <= now().getTime())
    throw new ValidationError("Giờ hẹn phải ở tương lai");
  // Chuẩn hoá về UTC để mọi provider nhận cùng một dạng, không phụ thuộc offset người nhập.
  return provider.publishPost({
    ...input,
    scheduledAt: new Date(at).toISOString(),
  });
}

const ISO_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/** Chỉ nhận ISO 8601 có múi giờ và ngày có thật; trả mili giây epoch, hoặc undefined. */
export function parseIsoWithOffset(value: string): number | undefined {
  const m = ISO_WITH_OFFSET.exec(value);
  if (!m) return undefined;
  // Nhóm 1–5 và 7 luôn có khi regex khớp; nhóm 6 (giây) tuỳ chọn.
  const [y, mo, d, h, mi] = [1, 2, 3, 4, 5].map((i) => Number(m[i])) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const s = m[6] === undefined ? 0 : Number(m[6]);
  const off = m[7] as string;
  if (h > 23 || mi > 59 || s > 59) return undefined;
  if (
    off !== "Z" &&
    (Number(off.slice(1, 3)) > 23 || Number(off.slice(4)) > 59)
  )
    return undefined;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== mo - 1 ||
    probe.getUTCDate() !== d
  )
    return undefined;
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : t;
}
