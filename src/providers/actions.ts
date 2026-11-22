import {
  UnsupportedError,
  ValidationError,
  type Capability,
  type InboxItem,
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
  if (!provider.support[platform]?.includes(capability)) {
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

export async function publishPost(
  provider: SocialProvider,
  input: PublishInput,
): Promise<PublishResult> {
  requireSupport(provider, input.platform, "publish");
  if (!provider.publishPost) {
    throw new UnsupportedError(input.platform, "publish", "not_implemented");
  }
  if (input.text.trim() === "")
    throw new ValidationError("Nội dung bài đăng không được rỗng");
  if (
    input.scheduledAt !== undefined &&
    Number.isNaN(Date.parse(input.scheduledAt))
  ) {
    throw new ValidationError("Giờ hẹn phải là ngày giờ ISO 8601 hợp lệ");
  }
  return provider.publishPost(input);
}
