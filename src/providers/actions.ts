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
  const [y, mo, d, h, mi, s = 0] = m.slice(1, 7).map(Number);
  const off = m[7];
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
