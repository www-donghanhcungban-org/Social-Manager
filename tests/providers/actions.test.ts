import { describe, expect, it } from "vitest";

import { listInbox, publishPost } from "@/src/providers/actions";
import { createDemoProvider } from "@/src/providers/demo";
import { createSocialApiProvider } from "@/src/providers/socialapi";
import {
  CAPABILITIES,
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
    if (u.includes("/inbox/conversations")) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
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

    it("publishPost trả id và trạng thái published khi không hẹn giờ", async () => {
      const p = make();
      const r = await publishPost(p, base(p), clock);
      expect(r.id).toBeTruthy();
      expect(r.status).toBe("published");
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
      ]) {
        await expect(
          publishPost(p, { ...base(p), scheduledAt }, clock),
        ).rejects.toBeInstanceOf(ValidationError);
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
