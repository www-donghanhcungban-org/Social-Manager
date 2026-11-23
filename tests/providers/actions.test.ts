import { describe, expect, it, vi } from "vitest";

import {
  listConversations,
  listInbox,
  listMessages,
  parseIsoWithOffset,
  publishPost,
  sendMessage,
  supportsConversations,
  supportsSend,
} from "@/src/providers/actions";
import { createDemoProvider } from "@/src/providers/demo";
import { createSocialApiProvider } from "@/src/providers/socialapi";
import {
  CAPABILITIES,
  MESSAGE_DIRECTIONS,
  PLATFORMS,
  UnsupportedError,
  ValidationError,
  type InboxKind,
  type PublishInput,
  type SocialProvider,
} from "@/src/providers/types";

const NOW = new Date("2026-11-22T10:00:00.000Z");
const clock = { now: () => NOW };

/** SocialAPI giả: nhận POST /posts và GET /inbox/conversations, không gọi mạng. */
function fakeSocialApiFetch() {
  let seq = 0;
  return async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (init?.method === "POST" && u.endsWith("/posts")) {
      const body = JSON.parse(String(init.body)) as { scheduled_at?: string };
      seq += 1;
      return new Response(
        JSON.stringify({
          data: {
            id: `post_${seq}`,
            status: body.scheduled_at ? "scheduled" : "publishing",
          },
        }),
        { status: 200 },
      );
    }
    if (init?.method === "POST" && u.includes("/messages")) {
      return new Response(
        JSON.stringify({ success: true, message_ids: ["sent-1"] }),
        { status: 200 },
      );
    }
    if (u.includes("/messages")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "m-uuid-2",
              platform_id: "mid.2",
              direction: "outgoing",
              text: "Dạ còn",
              sender_id: "page",
              created_at: "2026-11-22T09:01:00Z",
            },
            {
              id: "m-uuid-1",
              platform_id: "mid.1",
              direction: "incoming",
              text: "Còn hàng?",
              sender_id: "psid",
              sender_name: "Lan",
              created_at: "2026-11-22T09:00:00Z",
            },
          ],
          pagination: { has_more: false },
        }),
        { status: 200 },
      );
    }
    if (u.includes("/inbox/conversations")) {
      const platform = new URL(u).searchParams.get("platform") ?? "facebook";
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "conv-1",
              platform,
              participant_id: "psid",
              participant_name: "Lan",
              last_message_at: "2026-11-22T09:01:00Z",
              created_at: "2026-11-01T00:00:00Z",
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 404 });
  };
}

/** Mọi provider có cài đặt thật phải qua bộ hợp đồng này (thêm provider = thêm một dòng). */
const providersUnderContract: [string, () => SocialProvider][] = [
  ["demo", () => createDemoProvider({ now: () => NOW })],
  [
    "socialapi",
    () => createSocialApiProvider({ apiKey: "k", fetch: fakeSocialApiFetch() }),
  ],
];

const KIND_CAP = {
  dm: "dm",
  comment: "comments",
  review: "reviews",
  mention: "mentions",
} as const satisfies Record<InboxKind, (typeof CAPABILITIES)[number]>;

describe.each(providersUnderContract)(
  "hợp đồng provider: %s",
  (_name, make) => {
    const base = (p: SocialProvider): PublishInput => {
      const platform = PLATFORMS.find((pl) =>
        p.support[pl]?.includes("publish"),
      );
      if (!platform)
        throw new Error("provider không khai nền tảng nào đăng được");
      return { platform, accountId: "a", text: "Xin chào" };
    };

    it("từ chối nền tảng không khai đăng bài bằng UnsupportedError có mã, trước khi gọi mạng", async () => {
      const p = make();
      for (const platform of PLATFORMS) {
        if (p.support[platform]?.includes("publish")) continue;
        await expect(
          publishPost(p, { platform, accountId: "a", text: "x" }, clock),
        ).rejects.toMatchObject({ code: "unsupported" });
      }
    });

    it("provider khai hỗ trợ thì phải cài đặt hành động tương ứng", () => {
      const p = make();
      const declares = (cap: (typeof CAPABILITIES)[number]) =>
        PLATFORMS.some((pl) => p.support[pl]?.includes(cap));
      if (declares("publish")) expect(p.publishPost).toBeTypeOf("function");
      if (
        declares("dm") ||
        declares("comments") ||
        declares("reviews") ||
        declares("mentions")
      ) {
        expect(p.listInbox).toBeTypeOf("function");
      }
    });

    it("listInbox mọi loại provider khai hỗ trợ: trả mảng, đúng nền tảng/loại, thời gian ISO UTC", async () => {
      const p = make();
      for (const platform of PLATFORMS) {
        for (const [kind, cap] of Object.entries(KIND_CAP) as [
          InboxKind,
          string,
        ][]) {
          if (
            !p.support[platform]?.includes(cap as (typeof CAPABILITIES)[number])
          )
            continue;
          const items = await listInbox(p, {
            platform,
            accountId: "acc1",
            kind,
          });
          expect(Array.isArray(items)).toBe(true);
          for (const it of items) {
            expect(it.platform).toBe(platform);
            expect(it.kind).toBe(kind);
            expect(new Date(it.receivedAt).toISOString()).toBe(it.receivedAt);
          }
        }
      }
    });

    it("đọc DM theo hội thoại + tin nhắn: hình dạng trang, tin mới nhất trước, định danh và thời gian hợp lệ", async () => {
      const p = make();
      const platforms = PLATFORMS.filter((pl) => supportsConversations(p, pl));
      expect(platforms.length).toBeGreaterThan(0);
      let seen = 0;
      for (const platform of platforms) {
        const convs = await listConversations(p, {
          platform,
          accountId: "acc1",
        });
        expect(
          convs.nextCursor === null || typeof convs.nextCursor === "string",
        ).toBe(true);
        for (const c of convs.items) {
          expect(c.id).toBeTruthy();
          if (c.lastMessageAt !== null)
            expect(parseIsoWithOffset(c.lastMessageAt)).toBeTypeOf("number");
          const msgs = await listMessages(p, {
            platform,
            accountId: "acc1",
            conversationId: c.id,
          });
          const times = msgs.items.map((m) => parseIsoWithOffset(m.sentAt)!);
          expect(times.every((t) => typeof t === "number")).toBe(true);
          expect([...times].sort((a, b) => b - a)).toEqual(times);
          for (const m of msgs.items) {
            seen++;
            expect(m.id).toBeTruthy();
            expect(m.providerMessageId).toBeTruthy();
            expect(MESSAGE_DIRECTIONS).toContain(m.direction);
          }
        }
      }
      expect(seen).toBeGreaterThan(0);
    });

    it("provider gửi được tin trả lời thì trả danh sách id (có thể rỗng), không ném khi nhà cung cấp chấp nhận", async () => {
      const p = make();
      const platforms = PLATFORMS.filter((pl) => supportsSend(p, pl));
      expect(platforms.length).toBeGreaterThan(0);
      for (const platform of platforms) {
        const r = await sendMessage(p, {
          platform,
          accountId: "acc1",
          conversationId: "conv-1",
          text: "Dạ còn ạ",
        });
        expect(Array.isArray(r.messageIds)).toBe(true);
        for (const id of r.messageIds) expect(id).not.toBe("");
      }
    });

    it("publishPost không hẹn giờ trả id và published, hoặc submitted kèm cách xác nhận lại", async () => {
      const p = make();
      const r = await publishPost(p, base(p), clock);
      expect(r.id).toBeTruthy();
      expect(["published", "submitted"]).toContain(r.status);
      // Provider báo "đã nhận, chưa biết kết quả" thì phải đọc lại được trạng thái (ADR-0002, H2).
      if (r.status === "submitted")
        expect(p.getPostStatus).toBeTypeOf("function");
    });

    it("publishPost hẹn giờ trong tương lai trả scheduled", async () => {
      const p = make();
      const r = await publishPost(
        p,
        { ...base(p), scheduledAt: "2026-11-23T08:00:00.000Z" },
        clock,
      );
      expect(r.status).toBe("scheduled");
    });

    it("từ chối nội dung rỗng hoặc chỉ khoảng trắng bằng ValidationError", async () => {
      const p = make();
      for (const text of ["", "   ", "\n\t"]) {
        await expect(
          publishPost(p, { ...base(p), text }, clock),
        ).rejects.toBeInstanceOf(ValidationError);
      }
    });

    it("từ chối giờ hẹn không phải ISO hợp lệ, đã qua, hoặc đúng bằng hiện tại", async () => {
      const p = make();
      for (const scheduledAt of [
        "không phải ngày",
        "2026-13-45T00:00:00Z",
        "2026-11-22T09:00:00.000Z",
        "2026-11-22T10:00:00.000Z",
        "December 31, 2099",
        "2027-02-30T10:00:00Z",
        "2026-12-01T10:00",
        "2026-12-01",
        "2026-12-01T24:00:00Z",
      ]) {
        await expect(
          publishPost(p, { ...base(p), scheduledAt }, clock),
        ).rejects.toBeInstanceOf(ValidationError);
      }
    });

    it("chuẩn hoá giờ hẹn có offset về UTC trước khi đưa cho provider", async () => {
      const p = make();
      const spy = vi.spyOn(p, "publishPost");
      await publishPost(
        p,
        { ...base(p), scheduledAt: "2026-12-01T10:00:00+07:00" },
        clock,
      );
      expect(spy.mock.calls[0]?.[0].scheduledAt).toBe(
        "2026-12-01T03:00:00.000Z",
      );
    });

    it("tên nền tảng lạ (__proto__, toString) là UnsupportedError, không phải TypeError", async () => {
      const p = make();
      for (const platform of ["__proto__", "toString", "constructor"]) {
        await expect(
          publishPost(p, { ...base(p), platform: platform as never }, clock),
        ).rejects.toBeInstanceOf(UnsupportedError);
      }
    });

    it("hai lần đăng cùng nội dung cho ra hai id khác nhau", async () => {
      const p = make();
      const a = await publishPost(p, base(p), clock);
      const b = await publishPost(p, base(p), clock);
      expect(a.id).not.toBe(b.id);
    });
  },
);

describe("actions với provider không hỗ trợ", () => {
  const noSupport: SocialProvider = { id: "none", label: "none", support: {} };

  it("publishPost ném UnsupportedError kèm nền tảng và khả năng", async () => {
    const err = await publishPost(noSupport, {
      platform: "telegram",
      accountId: "a",
      text: "x",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnsupportedError);
    expect(err).toMatchObject({
      code: "unsupported",
      platform: "telegram",
      capability: "publish",
    });
  });

  it("listInbox ném UnsupportedError, không trả mảng rỗng giả", async () => {
    await expect(
      listInbox(noSupport, {
        platform: "facebook",
        accountId: "a",
        kind: "dm",
      }),
    ).rejects.toBeInstanceOf(UnsupportedError);
  });

  it("khai hỗ trợ nhưng thiếu cài đặt thì báo not_implemented, không nuốt lỗi", async () => {
    const lazy: SocialProvider = {
      id: "lazy",
      label: "lazy",
      support: { facebook: ["publish"] },
    };
    await expect(
      publishPost(lazy, { platform: "facebook", accountId: "a", text: "x" }),
    ).rejects.toMatchObject({ code: "not_implemented" });
  });
});
