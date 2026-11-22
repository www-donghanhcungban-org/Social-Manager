import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createConversationSync, SYNC_LIMITS } from "@/src/conversations/sync";
import {
  conversations,
  inboxItems,
  messages,
  providerConnections,
  socialAccounts,
  workspaces,
} from "@/src/db/schema";
import { SocialApiError } from "@/src/providers/socialapi";
import type {
  MessageDirection,
  ProviderMessage,
  SocialProvider,
} from "@/src/providers/types";

import { createTestDb } from "../db/helpers";

const T0 = Date.UTC(2026, 10, 22, 8, 0, 0);
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();

interface FakeConv {
  id: string;
  participantId: string;
  participantName: string;
  /** Tin, thứ tự bất kỳ; fake trả mới nhất trước. */
  msgs: ProviderMessage[];
  lastMessageAt?: string | null;
}

const m = (
  id: string,
  min: number,
  direction: MessageDirection = "incoming",
  text = `tin ${id}`,
): ProviderMessage => ({
  id,
  identityWeak: false,
  providerMessageId: `uuid-${id}`,
  direction,
  author: direction === "incoming" ? "Lan" : "Shop",
  text,
  sentAt: at(min),
});

/** Nhà cung cấp giả theo hợp đồng: hội thoại theo tin gần nhất trước, tin mới nhất trước, cursor = vị trí. */
function fakeProvider(convs: FakeConv[], pageSize = 100) {
  const failing = new Set<string>();
  const lastOf = (c: FakeConv) =>
    c.lastMessageAt !== undefined
      ? c.lastMessageAt
      : c.msgs.length === 0
        ? null
        : c.msgs
            .map((x) => x.sentAt)
            .sort()
            .at(-1)!;
  const page = <T>(all: T[], cursor?: string) => {
    const start = cursor ? Number(cursor) : 0;
    const end = start + pageSize;
    return {
      items: all.slice(start, end),
      nextCursor: end < all.length ? String(end) : null,
    };
  };
  const listMessages = vi.fn(
    async ({
      conversationId,
      cursor,
    }: {
      conversationId: string;
      cursor?: string;
    }) => {
      if (failing.has(conversationId))
        throw new SocialApiError("khoá sk-live-xyz lộ", 500, "http.500");
      const c = convs.find((x) => x.id === conversationId)!;
      const sorted = [...c.msgs].sort((a, b) =>
        b.sentAt.localeCompare(a.sentAt),
      );
      return page(sorted, cursor);
    },
  );
  const provider: SocialProvider = {
    id: "fake",
    label: "Fake",
    support: { facebook: ["dm"] },
    listConversations: async ({ cursor }) => {
      const sorted = [...convs].sort((a, b) =>
        (lastOf(b) ?? "").localeCompare(lastOf(a) ?? ""),
      );
      return page(
        sorted.map((c) => ({
          id: c.id,
          participantId: c.participantId,
          participantName: c.participantName,
          lastMessageAt: lastOf(c),
        })),
        cursor,
      );
    },
    listMessages,
  };
  return { provider, listMessages, failing };
}

let t: Awaited<ReturnType<typeof createTestDb>>;
let ws: string;
let account: { id: string; externalId: string; platform: "facebook" };

beforeEach(async () => {
  t = await createTestDb();
  const [w] = await t.db.insert(workspaces).values({ name: "A" }).returning();
  ws = w!.id;
  const [c] = await t.db
    .insert(providerConnections)
    .values({
      workspaceId: ws,
      provider: "fake",
      label: "c",
      credentialsEnc: "v1:x",
    })
    .returning();
  const [a] = await t.db
    .insert(socialAccounts)
    .values({
      connectionId: c!.id,
      platform: "facebook",
      externalId: "page1",
      displayName: "Trang",
    })
    .returning();
  account = { id: a!.id, externalId: "page1", platform: "facebook" };
});
afterEach(async () => {
  await t.client.close();
});

const sync = (p: SocialProvider) =>
  createConversationSync({
    db: t.db,
    errorCode: (e) => (e instanceof SocialApiError ? e.code : "internal"),
  }).syncAccount(ws, account, p);

const inbox = async () => t.db.select().from(inboxItems);
const msgIds = async () =>
  (await t.db.select().from(messages)).map((x) => x.externalId).sort();

describe("đồng bộ DM theo hội thoại + tin nhắn", () => {
  it("lần đầu: lưu hội thoại, tin nguyên văn (không cắt), mục hộp thư theo tin đến mới nhất", async () => {
    const long = "Tiếng Việt ữ ".repeat(1500); // > 10.000 ký tự
    const { provider } = fakeProvider([
      {
        id: "c1",
        participantId: "psid1",
        participantName: "Lan",
        msgs: [m("a", 1), m("b", 2, "incoming", long), m("c", 3, "outgoing")],
      },
    ]);
    const r = await sync(provider);
    expect(r).toMatchObject({
      conversations: 1,
      messages: 3,
      inboxUpdated: 1,
      rejected: 0,
      failed: [],
      more: false,
    });
    const stored = (await t.db.select().from(messages)).find(
      (x) => x.externalId === "b",
    )!;
    expect(stored.text).toBe(long);
    expect(stored.providerMessageId).toBe("uuid-b");
    const [item] = await inbox();
    expect(item).toMatchObject({
      kind: "dm",
      externalId: "c1",
      status: "open",
    });
    // mục hộp thư hiển thị tin ĐẾN mới nhất (b), không phải tin gửi đi (c); bản xem trước tối đa 10.000
    expect(item!.receivedAt.toISOString()).toBe(at(2));
    expect(item!.text).toHaveLength(10_000);
    const [conv] = await t.db.select().from(conversations);
    expect(conv!.syncedThrough!.toISOString()).toBe(at(3));
  });

  it("đồng bộ hai lần không nhân đôi tin hay mục hộp thư", async () => {
    const { provider } = fakeProvider([
      {
        id: "c1",
        participantId: "p",
        participantName: "Lan",
        msgs: [m("a", 1), m("b", 2)],
      },
    ]);
    await sync(provider);
    const r = await sync(provider);
    expect(r).toMatchObject({ messages: 0, inboxUpdated: 0 });
    expect(await msgIds()).toEqual(["a", "b"]);
    expect(await inbox()).toHaveLength(1);
  });

  it("hội thoại cũ có tin đến mới: tin mới vào DB và mục đã xử lý được mở lại", async () => {
    const c1: FakeConv = {
      id: "c1",
      participantId: "p",
      participantName: "Lan",
      msgs: [m("a", 1)],
    };
    const { provider } = fakeProvider([
      c1,
      {
        id: "c2",
        participantId: "q",
        participantName: "Minh",
        msgs: [m("x", 5)],
      },
    ]);
    await sync(provider);
    await t.db.update(inboxItems).set({ status: "handled", handledBy: "u1" });
    c1.msgs.push(m("a2", 10, "incoming", "Còn hàng không?"));
    const r = await sync(provider);
    expect(r.messages).toBe(1);
    const item = (await inbox()).find((x) => x.externalId === "c1")!;
    expect(item).toMatchObject({
      status: "open",
      handledBy: null,
      text: "Còn hàng không?",
    });
    expect((await inbox()).find((x) => x.externalId === "c2")!.status).toBe(
      "handled",
    );
  });

  it("tin gửi đi mới không mở lại mục đã xử lý", async () => {
    const c1: FakeConv = {
      id: "c1",
      participantId: "p",
      participantName: "Lan",
      msgs: [m("a", 1)],
    };
    const { provider } = fakeProvider([c1]);
    await sync(provider);
    await t.db.update(inboxItems).set({ status: "handled", handledBy: "u1" });
    c1.msgs.push(m("reply", 2, "outgoing", "Dạ còn ạ"));
    const r = await sync(provider);
    expect(r.messages).toBe(1);
    const [item] = await inbox();
    expect(item).toMatchObject({ status: "handled", text: "tin a" });
  });

  it("dừng ở hội thoại không có gì mới: không đọc tin của các hội thoại cũ hơn", async () => {
    const convs: FakeConv[] = [1, 2, 3].map((i) => ({
      id: `c${i}`,
      participantId: `p${i}`,
      participantName: `N${i}`,
      msgs: [m(`m${i}`, i)],
    }));
    const { provider, listMessages } = fakeProvider(convs);
    await sync(provider);
    listMessages.mockClear();
    convs[2]!.msgs.push(m("moi", 20)); // c3 thành mới nhất
    await sync(provider);
    expect(listMessages.mock.calls.map((c) => c[0].conversationId)).toEqual([
      "c3",
    ]);
  });

  it("chạm trần số trang: lưu cursor, lượt sau lấy tiếp phần lịch sử còn lại, không trùng không sót", async () => {
    // Một lượt đọc tối đa 2 × trần trang (lượt mới + đọc tiếp lịch sử), cỡ trang 2.
    const perRun = SYNC_LIMITS.messagePages * 2 * 2;
    const total = perRun + 5;
    const c1: FakeConv = {
      id: "c1",
      participantId: "p",
      participantName: "Lan",
      msgs: Array.from({ length: total }, (_, i) => m(`m${i}`, i)),
    };
    const { provider } = fakeProvider([c1], 2);
    const first = await sync(provider);
    expect(first.messages).toBe(perRun);
    expect(first.more).toBe(true);
    const [conv] = await t.db.select().from(conversations);
    expect(conv!.backfillCursor).not.toBeNull();
    // Trong lúc chờ có tin mới: lượt sau vừa lấy tin mới vừa lấy tiếp lịch sử
    c1.msgs.push(m("new", 100));
    const second = await sync(provider);
    expect(second.more).toBe(false);
    expect(await msgIds()).toHaveLength(total + 1);
    const [after] = await t.db.select().from(conversations);
    expect(after!.backfillCursor).toBeNull();
  });

  it("một hội thoại lỗi không chặn hội thoại khác; chỉ ghi mã lỗi an toàn và lượt sau thử lại", async () => {
    const { provider, failing } = fakeProvider([
      {
        id: "c1",
        participantId: "p",
        participantName: "Lan",
        msgs: [m("a", 1)],
      },
      {
        id: "c2",
        participantId: "q",
        participantName: "Minh",
        msgs: [m("b", 2)],
      },
    ]);
    failing.add("c2");
    const r = await sync(provider);
    expect(r.failed).toEqual([{ conversationId: "c2", code: "http.500" }]);
    expect(JSON.stringify(r)).not.toMatch(/sk-live/);
    expect(await msgIds()).toEqual(["a"]);
    failing.clear();
    await sync(provider);
    expect(await msgIds()).toEqual(["a", "b"]);
  });

  it("loại tin sai (id rỗng, ngày hỏng, hướng lạ) và đếm rejected; tin hợp lệ vẫn lưu", async () => {
    const { provider } = fakeProvider([
      {
        id: "c1",
        participantId: "p",
        participantName: "Lan",
        lastMessageAt: at(9),
        msgs: [
          { ...m("", 1) },
          { ...m("bad-date", 2), sentAt: "hôm qua" },
          { ...m("side", 3), direction: "sideways" as never },
          m("ok", 4),
        ],
      },
    ]);
    const r = await sync(provider);
    expect(r.rejected).toBe(3);
    expect(await msgIds()).toEqual(["ok"]);
  });

  it("hội thoại chỉ có tin gửi đi không tạo mục hộp thư", async () => {
    const { provider } = fakeProvider([
      {
        id: "c1",
        participantId: "p",
        participantName: "Lan",
        msgs: [m("o", 1, "outgoing")],
      },
    ]);
    const r = await sync(provider);
    expect(r.messages).toBe(1);
    expect(await inbox()).toEqual([]);
  });
});
