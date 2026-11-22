import { z } from "zod";

import {
  UnsupportedError,
  type Capability,
  type InboxItem,
  type Platform,
  type SocialProvider,
} from "../types";
import { parseIsoWithOffset } from "../actions";
import {
  createSocialApiClient,
  SocialApiError,
  type SocialApiClientOptions,
} from "./client";
import { socialApiPlatformSupport } from "./matrix";

export { socialApiPlatformSupport } from "./matrix";
export { createSocialApiClient, SocialApiError } from "./client";

/**
 * Hình dạng phản hồi theo kiểu của repo tham chiếu qthupro/socials-manager (các kiểu này tự dẫn
 * docs.social-api.ai/api-reference); CHƯA đối chiếu trực tiếp với docs: kiểm khi có khoá thật.
 */
const PostResponse = z.object({
  data: z.object({ id: z.string().min(1), status: z.string() }),
});

const isoDate = (s: string) => parseIsoWithOffset(s) !== undefined;

const ConversationList = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        platform: z.string(),
        participant_id: z.string(),
        participant_name: z.string().nullish(),
        last_message: z.string().nullish(),
        last_message_at: z.string().refine(isoDate).nullish(),
        created_at: z.string().refine(isoDate),
      }),
    )
    .nullable(),
});

/**
 * Phân trang của SocialAPI (guides/pagination.md, đọc 2026-11-22): `pagination{has_more,next_cursor}`, có endpoint đặt
 * `next_cursor` ở gốc; vắng hoặc rỗng = trang cuối.
 */
const Pagination = {
  pagination: z
    .object({
      has_more: z.boolean().nullish(),
      next_cursor: z.string().nullish(),
    })
    .nullish(),
  next_cursor: z.string().nullish(),
};

function nextCursorOf(res: {
  pagination?: {
    has_more?: boolean | null;
    next_cursor?: string | null;
  } | null;
  next_cursor?: string | null;
}): string | null {
  if (res.pagination?.has_more === false) return null;
  const c = res.pagination?.next_cursor ?? res.next_cursor ?? null;
  return c === null || c === "" ? null : c;
}

const ConversationPage = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        platform: z.string(),
        participant_id: z.string(),
        participant_name: z.string().nullish(),
        last_message_at: z.string().nullish(),
      }),
    )
    .nullable(),
  ...Pagination,
});

/** Tin nhắn trong hội thoại (guides/direct-messages.md): mới nhất trước; `platform_id` là id của nền tảng. */
const MessagePage = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        platform_id: z.string().nullish(),
        direction: z.string(),
        text: z.string().nullish(),
        sender_id: z.string().nullish(),
        sender_name: z.string().nullish(),
        created_at: z.string(),
      }),
    )
    .nullable(),
  ...Pagination,
});

const MAX_PAGE = 100;

const STATUS_MAP = new Map<string, "scheduled" | "published">([
  ["scheduled", "scheduled"],
  ["publishing", "published"],
  ["published", "published"],
]);

/** Chỉ phần ĐÃ cài đặt; phần còn lại của ma trận nền tảng thêm theo từng đợt. */
const IMPLEMENTED: readonly Capability[] = ["publish", "dm"];

// DEBT: chỉ đăng bài + DM; bình luận/đánh giá/lượt nhắc/thống kê chưa cài | trần: listInbox ném
// not_implemented cho kind khác dm | xem lại khi: làm hộp thư bình luận/đánh giá (đợt 2)
function implementedSupport(): SocialProvider["support"] {
  const out: SocialProvider["support"] = {};
  for (const [platform, caps] of Object.entries(socialApiPlatformSupport) as [
    Platform,
    readonly Capability[],
  ][]) {
    const kept = caps.filter((c) => IMPLEMENTED.includes(c));
    if (kept.length > 0) out[platform] = kept;
  }
  return out;
}

/** SocialAPI trả `platform` có thể là bí danh (vd instagram_fb): khớp tên chính xác hoặc tiền tố `<tên>_`. */
const matchesPlatform = (apiPlatform: string, platform: Platform) =>
  apiPlatform === platform || apiPlatform.startsWith(`${platform}_`);

export function createSocialApiProvider(
  opts: SocialApiClientOptions,
): SocialProvider {
  const client = createSocialApiClient(opts);
  return {
    id: "socialapi",
    label: "SocialAPI",
    support: implementedSupport(),

    async publishPost({ accountId, text, scheduledAt }) {
      const res = await client.post(
        "/posts",
        {
          text,
          targets: [{ account_id: accountId }],
          ...(scheduledAt === undefined
            ? { publish_now: true }
            : { scheduled_at: scheduledAt }),
        },
        PostResponse,
      );
      // API trả `publishing` ngay sau publish_now: với app, "đã nhận để đăng" tính là published.
      // Trạng thái lạ KHÔNG mặc định là thành công: coi là phản hồi không hợp lệ.
      const status = STATUS_MAP.get(res.data.status);
      if (status === undefined) {
        throw new SocialApiError(
          `Trạng thái bài đăng không nhận ra: ${JSON.stringify(res.data.status)}`,
          200,
          "client.invalid_response",
        );
      }
      return { id: res.data.id, status };
    },

    async listConversations({ platform, accountId, cursor }) {
      const res = await client.get("/inbox/conversations", ConversationPage, {
        account_id: accountId,
        limit: MAX_PAGE,
        cursor,
      });
      return {
        items: (res.data ?? [])
          .filter((c) => matchesPlatform(c.platform, platform))
          .map((c) => ({
            id: c.id,
            participantId: c.participant_id,
            participantName: c.participant_name || c.participant_id,
            lastMessageAt: c.last_message_at ?? null,
          })),
        nextCursor: nextCursorOf(res),
      };
    },

    async listMessages({ accountId, conversationId, cursor }) {
      const res = await client.get(
        `/inbox/conversations/${encodeURIComponent(conversationId)}/messages`,
        MessagePage,
        { account_id: accountId, limit: MAX_PAGE, cursor },
      );
      return {
        // Hướng lạ/ngày hỏng để tầng dịch vụ loại và đếm, không ném cả trang.
        items: (res.data ?? []).map((m) => ({
          id: m.platform_id || m.id,
          identityWeak: !m.platform_id,
          providerMessageId: m.id,
          direction: m.direction as "incoming" | "outgoing",
          author: m.sender_name || m.sender_id || "",
          text: m.text ?? "",
          sentAt: m.created_at,
        })),
        nextCursor: nextCursorOf(res),
      };
    },

    async listInbox({ platform, accountId, kind }) {
      if (kind !== "dm") {
        const cap = {
          comment: "comments",
          review: "reviews",
          mention: "mentions",
        } as const;
        throw new UnsupportedError(platform, cap[kind], "not_implemented");
      }
      const res = await client.get("/inbox/conversations", ConversationList, {
        account_id: accountId,
        limit: 50,
      });
      return (res.data ?? [])
        .filter((c) => matchesPlatform(c.platform, platform))
        .map((c): InboxItem => ({
          id: c.id,
          platform,
          kind: "dm",
          author: c.participant_name || c.participant_id,
          text: c.last_message ?? "",
          receivedAt: new Date(c.last_message_at ?? c.created_at).toISOString(),
        }));
    },
  };
}
