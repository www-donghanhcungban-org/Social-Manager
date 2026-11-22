import { z } from "zod";

import {
  UnsupportedError,
  type Capability,
  type InboxItem,
  type Platform,
  type SocialProvider,
} from "../types";
import { createSocialApiClient, type SocialApiClientOptions } from "./client";
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

const ConversationList = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        platform: z.string(),
        participant_id: z.string(),
        participant_name: z.string().nullish(),
        last_message: z.string().nullish(),
        last_message_at: z.string().nullish(),
        created_at: z.string(),
      }),
    )
    .nullable(),
});

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
      return {
        id: res.data.id,
        status: res.data.status === "scheduled" ? "scheduled" : "published",
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
