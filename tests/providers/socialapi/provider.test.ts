import { describe, expect, it, vi } from "vitest";

import { getPostStatus, listInbox, publishPost } from "@/src/providers/actions";
import { createSocialApiProvider } from "@/src/providers/socialapi";
import { UnsupportedError } from "@/src/providers/types";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init });

const post = (over: Record<string, unknown> = {}) => ({
  data: {
    id: "post_1",
    status: "publishing",
    text: "x",
    hidden: false,
    ...over,
  },
});

describe("createSocialApiProvider: support", () => {
  it("chỉ khai phần đã cài đặt (đăng bài và DM), không hứa bình luận/đánh giá", () => {
    const p = createSocialApiProvider({ apiKey: "k", fetch: vi.fn() });
    expect(p.support.facebook).toEqual(["publish", "dm"]);
    expect(p.support.telegram).toEqual(["dm"]);
    expect(p.support.google).toEqual(["publish"]);
    expect(p.support.app_store_connect).toBeUndefined();
  });
});

describe("SocialAPI: phản hồi bất thường (review 🟠)", () => {
  it.each(["failed", "error", "rejected", "draft", ""])(
    "trạng thái lạ %j không bị coi là published",
    async (status) => {
      const p = createSocialApiProvider({
        apiKey: "k",
        fetch: vi.fn(async () => json(post({ status }))),
      });
      await expect(
        publishPost(p, { platform: "facebook", accountId: "a", text: "x" }),
      ).rejects.toMatchObject({ code: "client.invalid_response" });
    },
  );

  it("`publishing` chỉ là đã nhận (submitted); chỉ `published` mới là đã đăng", async () => {
    for (const [status, want] of [
      ["publishing", "submitted"],
      ["published", "published"],
    ]) {
      const p = createSocialApiProvider({
        apiKey: "k",
        fetch: vi.fn(async () => json(post({ status }))),
      });
      const r = await publishPost(p, {
        platform: "facebook",
        accountId: "a",
        text: "x",
      });
      expect(r.status).toBe(want);
    }
  });

  it("getPostStatus: GET /posts/{id}, ánh xạ đủ 7 trạng thái; trạng thái lạ là lỗi có mã", async () => {
    const cases = [
      ["draft", "pending"],
      ["scheduled", "pending"],
      ["publishing", "pending"],
      ["published", "published"],
      ["partial", "partial"],
      ["failed", "failed"],
      ["cancelled", "cancelled"],
    ] as const;
    for (const [status, want] of cases) {
      const fetchMock = vi.fn(async () => json(post({ status })));
      const p = createSocialApiProvider({ apiKey: "k", fetch: fetchMock });
      expect(
        await getPostStatus(p, {
          platform: "facebook",
          accountId: "a",
          postId: "post/1",
        }),
      ).toBe(want);
      const calls = fetchMock.mock.calls as unknown as [string][];
      expect(String(calls[0]![0])).toBe(
        "https://api.social-api.ai/v1/posts/post%2F1",
      );
    }
    const odd = createSocialApiProvider({
      apiKey: "k",
      fetch: vi.fn(async () => json(post({ status: "teleported" }))),
    });
    await expect(
      getPostStatus(odd, { platform: "facebook", accountId: "a", postId: "p" }),
    ).rejects.toMatchObject({ code: "client.invalid_response" });
  });

  it.each(["", "not-a-date", "2026-13-40T00:00:00Z"])(
    "ngày hội thoại sai %j bị chặn bằng lỗi có mã, không phải RangeError",
    async (bad) => {
      const p = createSocialApiProvider({
        apiKey: "k",
        fetch: vi.fn(async () =>
          json({
            data: [
              {
                id: "c1",
                platform: "facebook",
                participant_id: "u",
                created_at: "2026-11-01T00:00:00Z",
                last_message_at: bad,
              },
            ],
          }),
        ),
      });
      await expect(
        listInbox(p, { platform: "facebook", accountId: "a", kind: "dm" }),
      ).rejects.toMatchObject({ code: "client.invalid_response" });
    },
  );
});

describe("publishPost qua SocialAPI", () => {
  it("đăng ngay: POST /posts với publish_now và targets; `publishing` trả submitted", async () => {
    const fetchMock = vi.fn(async () => json(post({ status: "publishing" })));
    const p = createSocialApiProvider({ apiKey: "k", fetch: fetchMock });
    const r = await publishPost(p, {
      platform: "facebook",
      accountId: "acc1",
      text: "Xin chào",
    });
    expect(r).toEqual({ id: "post_1", status: "submitted" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.social-api.ai/v1/posts");
    expect(JSON.parse(init.body as string)).toEqual({
      text: "Xin chào",
      publish_now: true,
      targets: [{ account_id: "acc1" }],
    });
  });

  it("hẹn giờ: gửi scheduled_at, không publish_now, trả scheduled", async () => {
    const fetchMock = vi.fn(async () => json(post({ status: "scheduled" })));
    const p = createSocialApiProvider({ apiKey: "k", fetch: fetchMock });
    const r = await publishPost(p, {
      platform: "threads",
      accountId: "acc1",
      text: "Hẹn",
      scheduledAt: "2026-12-01T08:00:00.000Z",
    });
    expect(r.status).toBe("scheduled");
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body.scheduled_at).toBe("2026-12-01T08:00:00.000Z");
    expect(body.publish_now).toBeUndefined();
  });

  it("nền tảng adapter chưa hỗ trợ đăng (telegram) bị chặn trước khi gọi mạng", async () => {
    const fetchMock = vi.fn();
    const p = createSocialApiProvider({ apiKey: "k", fetch: fetchMock });
    await expect(
      publishPost(p, { platform: "telegram", accountId: "a", text: "x" }),
    ).rejects.toBeInstanceOf(UnsupportedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("phản hồi thiếu id → lỗi invalid_response, không trả id giả", async () => {
    const p = createSocialApiProvider({
      apiKey: "k",
      fetch: async () => json({ data: { status: "publishing" } }),
    });
    await expect(
      publishPost(p, { platform: "facebook", accountId: "a", text: "x" }),
    ).rejects.toMatchObject({ code: "client.invalid_response" });
  });
});

const conv = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  account_id: "acc1",
  platform: "facebook",
  platform_id: "p1",
  participant_id: "u1",
  participant_name: "Lan",
  last_message: "Còn hàng không?",
  last_message_at: "2026-11-22T09:30:00Z",
  created_at: "2026-11-20T00:00:00Z",
  ...over,
});

const page = (data: unknown[] | null) => ({
  data,
  pagination: { has_more: false, next_cursor: "" },
});

describe("listInbox (dm) qua SocialAPI", () => {
  it("gọi GET /inbox/conversations theo tài khoản và ánh xạ sang InboxItem", async () => {
    const fetchMock = vi.fn(async () => json(page([conv()])));
    const p = createSocialApiProvider({ apiKey: "k", fetch: fetchMock });
    const items = await listInbox(p, {
      platform: "facebook",
      accountId: "acc1",
      kind: "dm",
    });
    expect(items).toEqual([
      {
        id: "c1",
        platform: "facebook",
        kind: "dm",
        author: "Lan",
        text: "Còn hàng không?",
        receivedAt: "2026-11-22T09:30:00.000Z",
      },
    ]);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain("/inbox/conversations?");
    expect(url).toContain("account_id=acc1");
  });

  it("data null → mảng rỗng; tên người gửi rỗng → dùng participant_id [F-002/AC-07]", async () => {
    const empty = createSocialApiProvider({
      apiKey: "k",
      fetch: async () => json(page(null)),
    });
    expect(
      await listInbox(empty, {
        platform: "facebook",
        accountId: "a",
        kind: "dm",
      }),
    ).toEqual([]);
    const noName = createSocialApiProvider({
      apiKey: "k",
      fetch: async () => json(page([conv({ participant_name: "" })])),
    });
    const [it] = await listInbox(noName, {
      platform: "facebook",
      accountId: "a",
      kind: "dm",
    });
    expect(it?.author).toBe("u1");
  });

  it("last_message_at null → dùng created_at; chỉ lấy hội thoại đúng nền tảng (kể cả bí danh)", async () => {
    const p = createSocialApiProvider({
      apiKey: "k",
      fetch: async () =>
        json(
          page([
            conv({ id: "c1", last_message_at: null }),
            conv({ id: "c2", platform: "instagram" }),
            conv({ id: "c3", platform: "facebook_alias" }),
          ]),
        ),
    });
    const items = await listInbox(p, {
      platform: "facebook",
      accountId: "a",
      kind: "dm",
    });
    expect(items.map((i) => i.id)).toEqual(["c1", "c3"]);
    expect(items[0]?.receivedAt).toBe("2026-11-20T00:00:00.000Z");
  });

  it("loại hộp thư chưa cài đặt (comment) báo not_implemented, không trả rỗng giả", async () => {
    const p = createSocialApiProvider({ apiKey: "k", fetch: vi.fn() });
    await expect(
      listInbox(p, { platform: "facebook", accountId: "a", kind: "comment" }),
    ).rejects.toBeInstanceOf(UnsupportedError);
  });
});
