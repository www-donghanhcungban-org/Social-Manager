import { z } from "zod";

import {
  UnsupportedError,
  type Capability,
  type InboxItem,
  type Platform,
  SendRejectedError,
  type RemotePostStatus,
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
// Điểm xuất công khai cho tầng HTTP (ARC-MOD-005): route webhook không import `./webhook` nội bộ.
export {
  parseWebhookEvent,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifyWebhookSignature,
} from "./webhook";

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

/**
 * Phản hồi gửi tin (guides/direct-messages.md, đọc 2026-11-22): `success` + `message_ids[]` (Zalo trả chuỗi rỗng). BẮT BUỘC
 * có `success`: thiếu nó là phản hồi không xác nhận được → client.invalid_response → hành động `send_unknown`.
 */
const SendResponse = z.object({
  success: z.boolean(),
  message_ids: z.array(z.string()).nullish(),
});

/** Lỗi 4xx (trừ 408) = nhà cung cấp từ chối trước khi xử lý: chắc chắn chưa gửi. */
const isDefiniteRejection = (e: SocialApiError) =>
  e.status >= 400 && e.status < 500 && e.status !== 408;
/** (chưa xác minh) tên mã khi hết cửa sổ nhắn tin; nhận theo từ khoá để không phụ thuộc đúng một chuỗi. */
const isWindowClosed = (code: string) => /window|expired|24/i.test(code);

const MAX_PAGE = 100;

/**
 * Giá trị đầu tiên không thiếu và không rỗng (BASE-DATA-003): nhà cung cấp có thể trả `null`, thiếu hoặc `""` cho tên;
 * ở đây chuỗi rỗng cố ý coi là thiếu (khác `||` mù với 0/false), cuối cùng là chuỗi rỗng.
 */
function firstNonEmpty(...values: (string | null | undefined)[]): string {
  return values.find((v) => v !== undefined && v !== null && v !== "") ?? "";
}

/**
 * Trạng thái bài của SocialAPI (docs, đọc 2026-11-22): draft, scheduled, publishing, published, partial, failed,
 * cancelled. `publishing` là ĐÃ NHẬN, chưa phải đã lên mạng → `submitted`, xác nhận sau (ADR-0002, H2).
 */
const STATUS_MAP = new Map<string, "scheduled" | "published" | "submitted">([
  ["scheduled", "scheduled"],
  ["publishing", "submitted"],
  ["published", "published"],
]);

const REMOTE_STATUS_MAP = new Map<string, RemotePostStatus>([
  ["draft", "pending"],
  ["scheduled", "pending"],
  ["publishing", "pending"],
  ["published", "published"],
  ["partial", "partial"],
  ["failed", "failed"],
  ["cancelled", "cancelled"],
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

    async getPostStatus({ postId }) {
      // Hình dạng phản hồi giả định giống POST /posts (`data{id,status}`) — (chưa xác minh với khoá thật).
      const res = await client.get(
        `/posts/${encodeURIComponent(postId)}`,
        PostResponse,
      );
      const status = REMOTE_STATUS_MAP.get(res.data.status);
      if (status === undefined) {
        throw new SocialApiError(
          `Trạng thái bài đăng không nhận ra: ${JSON.stringify(res.data.status)}`,
          200,
          "client.invalid_response",
        );
      }
      return { status };
    },

    async sendMessage({ accountId, conversationId, text }) {
      try {
        const res = await client.post(
          `/inbox/conversations/${encodeURIComponent(conversationId)}/messages`,
          { account_id: accountId, text },
          SendResponse,
        );
        if (!res.success)
          throw new SendRejectedError("provider_declined", "rejected");
        return {
          messageIds: (res.message_ids ?? []).filter((id) => id !== ""),
        };
      } catch (e) {
        // `client.invalid_path`: bị chặn trước khi gọi mạng, nên chắc chắn chưa gửi gì.
        if (
          e instanceof SocialApiError &&
          (isDefiniteRejection(e) || e.code === "client.invalid_path")
        ) {
          const safe = /^[A-Za-z0-9_.-]{1,64}$/.test(e.code)
            ? e.code
            : `http.${e.status}`;
          throw new SendRejectedError(
            safe,
            isWindowClosed(e.code) ? "window_closed" : "rejected",
          );
        }
        // Hết giờ, mất kết nối, 5xx, phản hồi sai hình dạng: KHÔNG CHẮC — ném nguyên để tầng hành động ghi send_unknown.
        throw e;
      }
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
            participantName: firstNonEmpty(
              c.participant_name,
              c.participant_id,
            ),
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
          id: firstNonEmpty(m.platform_id, m.id),
          identityWeak:
            m.platform_id === undefined ||
            m.platform_id === null ||
            m.platform_id === "",
          providerMessageId: m.id,
          direction: m.direction as "incoming" | "outgoing",
          author: firstNonEmpty(m.sender_name, m.sender_id),
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
          author: firstNonEmpty(c.participant_name, c.participant_id),
          text: c.last_message ?? "",
          receivedAt: new Date(c.last_message_at ?? c.created_at).toISOString(),
        }));
    },
  };
}
