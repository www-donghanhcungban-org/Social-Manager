import { describe, expect, it, vi } from "vitest";

import {
  listConversations,
  listMessages,
  supportsConversations,
} from "@/src/providers/actions";
import { createSocialApiProvider } from "@/src/providers/socialapi";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });

/** Hình dạng theo docs.social-api.ai/guides/direct-messages.md + pagination.md (đọc 2026-11-22). */
const conversation = (over: Record<string, unknown> = {}) => ({
  id: "6f1c2d3e-0000-4000-8000-000000000001",
  account_id: "acc_1",
  platform: "facebook",
  participant_id: "psid_9",
  participant_name: "Lan",
  last_message: "Còn hàng không?",
  last_message_at: "2026-11-22T09:00:00Z",
  created_at: "2026-11-01T00:00:00Z",
  ...over,
});

const message = (over: Record<string, unknown> = {}) => ({
  id: "7a000000-0000-4000-8000-000000000001",
  conversation_id: "6f1c2d3e-0000-4000-8000-000000000001",
  platform_id: "m_abc",
  direction: "incoming",
  text: "Còn hàng không?",
  sender_id: "psid_9",
  sender_name: "Lan",
  created_at: "2026-11-22T09:00:00Z",
  ...over,
});

function provider(fetchImpl: typeof fetch) {
  return createSocialApiProvider({ apiKey: "k", fetch: fetchImpl });
}

describe("SocialAPI: hội thoại có phân trang", () => {
  it("gọi /inbox/conversations theo tài khoản, limit 100, chuyển cursor; ánh xạ đủ trường", async () => {
    const f = vi.fn(async () =>
      json({
        data: [conversation()],
        pagination: { limit: 100, has_more: true, next_cursor: "c2" },
      }),
    );
    const page = await listConversations(provider(f), {
      platform: "facebook",
      accountId: "acc_1",
      cursor: "c1",
    });
    const url = new URL(String((f.mock.calls[0] as unknown[])[0]));
    expect(url.pathname).toBe("/v1/inbox/conversations");
    expect(url.searchParams.get("account_id")).toBe("acc_1");
    expect(url.searchParams.get("limit")).toBe("100");
    expect(url.searchParams.get("cursor")).toBe("c1");
    expect(page).toEqual({
      items: [
        {
          id: "6f1c2d3e-0000-4000-8000-000000000001",
          participantId: "psid_9",
          participantName: "Lan",
          lastMessageAt: "2026-11-22T09:00:00Z",
        },
      ],
      nextCursor: "c2",
    });
  });

  it.each([
    [{ pagination: { has_more: false, next_cursor: "x" } }],
    [{ pagination: { has_more: true, next_cursor: "" } }],
    [{ next_cursor: "" }],
    [{}],
  ])("trang cuối khi %j", async (pag) => {
    const page = await listConversations(
      provider(vi.fn(async () => json({ data: [], ...pag }))),
      { platform: "facebook", accountId: "acc_1" },
    );
    expect(page.nextCursor).toBeNull();
  });

  it("next_cursor ở gốc phản hồi cũng được nhận", async () => {
    const page = await listConversations(
      provider(vi.fn(async () => json({ data: null, next_cursor: "n" }))),
      { platform: "facebook", accountId: "acc_1" },
    );
    expect(page).toEqual({ items: [], nextCursor: "n" });
  });

  it("chỉ lấy hội thoại đúng nền tảng; tên trống dùng participant_id; chưa có tin → lastMessageAt null", async () => {
    const page = await listConversations(
      provider(
        vi.fn(async () =>
          json({
            data: [
              conversation({ platform: "instagram" }),
              conversation({
                id: "c-2",
                participant_name: "",
                last_message_at: null,
              }),
            ],
          }),
        ),
      ),
      { platform: "facebook", accountId: "acc_1" },
    );
    expect(page.items).toEqual([
      {
        id: "c-2",
        participantId: "psid_9",
        participantName: "psid_9",
        lastMessageAt: null,
      },
    ]);
  });
});

describe("SocialAPI: tin nhắn trong hội thoại", () => {
  it("gọi đúng đường dẫn (id được mã hoá), dùng platform_id làm định danh ổn định", async () => {
    const f = vi.fn(async () =>
      json({
        data: [message()],
        pagination: { has_more: false },
      }),
    );
    const page = await listMessages(provider(f), {
      platform: "facebook",
      accountId: "acc_1",
      conversationId: "a/b?c",
    });
    const url = new URL(String((f.mock.calls[0] as unknown[])[0]));
    expect(url.pathname).toBe("/v1/inbox/conversations/a%2Fb%3Fc/messages");
    expect(url.searchParams.get("account_id")).toBe("acc_1");
    expect(page).toEqual({
      items: [
        {
          id: "m_abc",
          identityWeak: false,
          providerMessageId: "7a000000-0000-4000-8000-000000000001",
          direction: "incoming",
          author: "Lan",
          text: "Còn hàng không?",
          sentAt: "2026-11-22T09:00:00Z",
        },
      ],
      nextCursor: null,
    });
  });

  it("không có platform_id (Zalo) → dùng id nhà cung cấp, đánh dấu identityWeak", async () => {
    const page = await listMessages(
      provider(
        vi.fn(async () =>
          json({ data: [message({ platform_id: null, sender_name: null })] }),
        ),
      ),
      { platform: "zalo", accountId: "acc_1", conversationId: "c" },
    );
    expect(page.items[0]).toMatchObject({
      id: "7a000000-0000-4000-8000-000000000001",
      identityWeak: true,
      author: "psid_9",
    });
  });

  it("nội dung dài hơn 10.000 ký tự được giữ nguyên", async () => {
    const long = "ă".repeat(25_000);
    const page = await listMessages(
      provider(vi.fn(async () => json({ data: [message({ text: long })] }))),
      { platform: "facebook", accountId: "acc_1", conversationId: "c" },
    );
    expect(page.items[0]!.text).toHaveLength(25_000);
  });

  it("id hội thoại rỗng bị từ chối trước khi gọi mạng", async () => {
    const f = vi.fn();
    await expect(
      listMessages(provider(f), {
        platform: "facebook",
        accountId: "acc_1",
        conversationId: "",
      }),
    ).rejects.toMatchObject({ code: "validation" });
    expect(f).not.toHaveBeenCalled();
  });

  it("nền tảng không khai DM (google) bị chặn bằng unsupported", async () => {
    const p = provider(vi.fn());
    expect(supportsConversations(p, "google")).toBe(false);
    expect(supportsConversations(p, "facebook")).toBe(true);
    await expect(
      listConversations(p, { platform: "google", accountId: "a" }),
    ).rejects.toMatchObject({ code: "unsupported" });
  });
});
