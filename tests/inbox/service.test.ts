import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError, NotFoundError } from "@/src/auth/errors";
import {
  inboxItems,
  members,
  providerConnections,
  socialAccounts,
  workspaces,
} from "@/src/db/schema";
import { createInboxService } from "@/src/inbox/service";
import { SocialApiError } from "@/src/providers/socialapi";
import {
  UnsupportedError,
  ValidationError,
  type InboxItem,
  type InboxQuery,
  type SocialProvider,
} from "@/src/providers/types";
import { createSecretBox } from "@/src/security/secret-box";

import { createTestDb } from "../db/helpers";

const box = createSecretBox(randomBytes(32).toString("base64"));
let t: Awaited<ReturnType<typeof createTestDb>>;
let ws: string;
let account: string;
let foreignAccount: string;
let listFn: ReturnType<typeof vi.fn>;
let credsSeen: string[];

const item = (over: Partial<InboxItem> = {}): InboxItem => ({
  id: "m1",
  platform: "facebook",
  kind: "dm",
  author: "Lan",
  text: "Chào shop",
  receivedAt: "2026-11-22T08:00:00.000Z",
  ...over,
});

function provider(): SocialProvider {
  return {
    id: "stub",
    label: "Stub",
    support: { facebook: ["dm", "comments", "reviews"] },
    listInbox: listFn as unknown as SocialProvider["listInbox"],
  };
}

const svc = () =>
  createInboxService({
    db: t.db,
    box,
    resolveProvider: (_id, creds) => {
      credsSeen.push(creds);
      return provider();
    },
  });

async function seedAccount(workspaceId: string, ext: string) {
  const [c] = await t.db
    .insert(providerConnections)
    .values({
      workspaceId,
      provider: "stub",
      label: `c-${ext}`,
      credentialsEnc: box.encrypt(`KEY-${ext}`),
    })
    .returning();
  const [a] = await t.db
    .insert(socialAccounts)
    .values({
      connectionId: c!.id,
      platform: "facebook",
      externalId: ext,
      displayName: ext,
    })
    .returning();
  return a!.id;
}

beforeEach(async () => {
  t = await createTestDb();
  credsSeen = [];
  listFn = vi.fn(async (q: InboxQuery) =>
    q.kind === "dm" ? [item()] : ([] as InboxItem[]),
  );
  const [a] = await t.db.insert(workspaces).values({ name: "A" }).returning();
  const [b] = await t.db.insert(workspaces).values({ name: "B" }).returning();
  ws = a!.id;
  await t.db.insert(members).values([
    { workspaceId: ws, userId: "member", role: "member" },
    { workspaceId: b!.id, userId: "outsider", role: "owner" },
  ]);
  account = await seedAccount(ws, "page1");
  foreignAccount = await seedAccount(b!.id, "page2");
});
afterEach(async () => {
  await t.client.close();
});

const sync = (over = {}) =>
  svc().sync({
    actorId: "member",
    workspaceId: ws,
    accountId: account,
    ...over,
  });

describe("sync", () => {
  it("nhập tin mới vào DB bằng khoá đã giải mã, hỏi mọi loại provider hỗ trợ [F-003/AC-01]", async () => {
    const r = await sync();
    expect(r.inserted).toBe(1);
    expect(listFn.mock.calls.map((c) => c[0].kind).sort()).toEqual([
      "comment",
      "dm",
      "review",
    ]);
    expect(listFn.mock.calls[0]![0]).toMatchObject({
      platform: "facebook",
      accountId: "page1",
    });
    expect(credsSeen[0]).toBe("KEY-page1");
    const [row] = await t.db.select().from(inboxItems);
    expect(row).toMatchObject({
      kind: "dm",
      externalId: "m1",
      author: "Lan",
      text: "Chào shop",
      status: "open",
      workspaceId: ws,
    });
    expect(row!.receivedAt.toISOString()).toBe("2026-11-22T08:00:00.000Z");
  });

  it("đồng bộ lặp lại không tạo bản trùng và không ghi đè trạng thái đã xử lý [F-003/AC-02]", async () => {
    await sync();
    const [row] = await t.db.select().from(inboxItems);
    await svc().setStatus({
      actorId: "member",
      workspaceId: ws,
      itemId: row!.id,
      status: "handled",
    });
    const r = await sync();
    expect(r.inserted).toBe(0);
    const rows = await t.db.select().from(inboxItems);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("handled");
  });

  it("hai lượt đồng bộ cùng tài khoản chạy cùng lúc: không bản trùng [F-003/AC-02]", async () => {
    const results = await Promise.all([sync(), sync()]);
    expect(results.reduce((n, r) => n + r.inserted, 0)).toBe(1);
    expect(await t.db.select().from(inboxItems)).toHaveLength(1);
  });

  it("cùng id ở loại khác nhau là hai mục khác nhau [F-003/AC-02]", async () => {
    listFn.mockImplementation(async (q: InboxQuery) =>
      q.kind === "dm" || q.kind === "comment"
        ? [item({ id: "same", kind: q.kind })]
        : [],
    );
    expect((await sync()).inserted).toBe(2);
  });

  it("loại chưa cài đặt được báo skipped, loại khác vẫn nhập [F-003/AC-10]", async () => {
    listFn.mockImplementation(async (q: InboxQuery) => {
      if (q.kind === "review")
        throw new UnsupportedError("facebook", "reviews", "not_implemented");
      return q.kind === "dm" ? [item()] : [];
    });
    const r = await sync();
    expect(r).toMatchObject({ inserted: 1, skipped: ["review"], failed: [] });
  });

  it("một loại lỗi chỉ ghi mã an toàn, không lộ nội dung lỗi, loại khác vẫn nhập [F-003/AC-10]", async () => {
    listFn.mockImplementation(async (q: InboxQuery) => {
      if (q.kind === "comment")
        throw new SocialApiError("token sk-live-abc sai", 401, "http.401");
      if (q.kind === "review") throw new Error("postgres://u:pw@h/db");
      return q.kind === "dm" ? [item()] : [];
    });
    const r = await sync();
    expect(r.inserted).toBe(1);
    expect(r.failed).toEqual(
      expect.arrayContaining([
        { kind: "comment", code: "http.401" },
        { kind: "review", code: "internal" },
      ]),
    );
    expect(JSON.stringify(r)).not.toMatch(/sk-live|pw@/);
  });

  it("bỏ qua mục sai: id rỗng, ngày không hợp lệ, kind lệch; đếm rejected [F-003/AC-10]", async () => {
    listFn.mockImplementation(async (q: InboxQuery) =>
      q.kind === "dm"
        ? [
            item({ id: "" }),
            item({ id: "x", receivedAt: "hôm qua" }),
            item({ id: "y", receivedAt: "2026-11-22T08:00:00" }),
            item({ id: "z", kind: "comment" }),
            item({ id: "ok" }),
          ]
        : [],
    );
    const r = await sync();
    expect(r).toMatchObject({ inserted: 1, rejected: 4 });
    const rows = await t.db.select().from(inboxItems);
    expect(rows.map((x) => x.externalId)).toEqual(["ok"]);
  });

  it("chuẩn hoá NFC, cắt tên, giới hạn độ dài nội dung 10000 ký tự [F-003/AC-01]", async () => {
    listFn.mockImplementation(async (q: InboxQuery) =>
      q.kind === "dm"
        ? [item({ author: "  Café ", text: "x".repeat(20_000) })]
        : [],
    );
    await sync();
    const [row] = await t.db.select().from(inboxItems);
    expect(row!.author).toBe("Café");
    expect(row!.text).toHaveLength(10_000);
  });

  it("nội dung rỗng vẫn nhập được (tin chỉ có ảnh), nhưng không phải null [F-003/AC-01]", async () => {
    listFn.mockImplementation(async (q: InboxQuery) =>
      q.kind === "dm" ? [item({ text: "" })] : [],
    );
    await sync();
    const [row] = await t.db.select().from(inboxItems);
    expect(row!.text).toBe("");
  });

  it("provider đọc được hội thoại thì DM đi đường hội thoại + tin nhắn, không dùng listInbox cho DM [F-003/AC-01]", async () => {
    const withConv = (): SocialProvider => ({
      ...provider(),
      listConversations: async () => ({
        items: [
          {
            id: "conv-1",
            participantId: "psid",
            participantName: "Lan",
            lastMessageAt: "2026-11-22T08:00:00.000Z",
          },
        ],
        nextCursor: null,
      }),
      listMessages: async () => ({
        items: [
          {
            id: "mid.1",
            identityWeak: false,
            providerMessageId: "u1",
            direction: "incoming",
            author: "Lan",
            text: "Chào shop",
            sentAt: "2026-11-22T08:00:00.000Z",
          },
        ],
        nextCursor: null,
      }),
    });
    const r = await createInboxService({
      db: t.db,
      box,
      resolveProvider: () => withConv(),
    }).sync({ actorId: "member", workspaceId: ws, accountId: account });
    expect(r).toMatchObject({ inserted: 1, messages: 1, more: false });
    expect(listFn.mock.calls.map((c) => c[0].kind).sort()).toEqual([
      "comment",
      "review",
    ]);
    const [row] = await t.db.select().from(inboxItems);
    expect(row).toMatchObject({ kind: "dm", externalId: "conv-1" });
  });

  it("người ngoài bị Forbidden; tài khoản workspace khác hoặc id lạ là NotFound [F-003/AC-09]", async () => {
    await expect(sync({ actorId: "outsider" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(sync({ accountId: foreignAccount })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(sync({ accountId: "lạ" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(listFn).not.toHaveBeenCalled();
  });
});

describe("list", () => {
  async function seedMany(n: number) {
    for (let i = 0; i < n; i++) {
      await t.db.insert(inboxItems).values({
        workspaceId: ws,
        socialAccountId: account,
        kind: i % 2 ? "comment" : "dm",
        externalId: `e${i}`,
        author: "A",
        text: `t${i}`,
        // 3 mục cuối cùng giờ nhận, để thử phân trang khi trùng thời điểm
        receivedAt: new Date(Date.UTC(2026, 10, 1, 0, 0, Math.min(i, n - 3))),
      });
    }
  }

  it("mới nhất trước; phân trang bằng cursor không sót, không lặp kể cả khi trùng giờ [F-003/AC-04]", async () => {
    await seedMany(7);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await svc().list({
        actorId: "member",
        workspaceId: ws,
        limit: 3,
        cursor,
      });
      expect(page.items.length).toBeLessThanOrEqual(3);
      seen.push(...page.items.map((i) => i.externalId));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    const first = await svc().list({
      actorId: "member",
      workspaceId: ws,
      limit: 1,
    });
    expect(first.items[0]!.receivedAt.getTime()).toBe(
      Date.UTC(2026, 10, 1, 0, 0, 4),
    );
  });

  it("lọc theo loại và trạng thái [F-003/AC-04]", async () => {
    await seedMany(6);
    const dm = await svc().list({
      actorId: "member",
      workspaceId: ws,
      kind: "dm",
    });
    expect(dm.items.every((i) => i.kind === "dm")).toBe(true);
    expect(dm.items).toHaveLength(3);
    const handled = await svc().list({
      actorId: "member",
      workspaceId: ws,
      status: "handled",
    });
    expect(handled.items).toHaveLength(0);
  });

  it("limit bị kẹp vào 1..100; cursor hỏng là ValidationError [F-003/AC-04]", async () => {
    await seedMany(3);
    const big = await svc().list({
      actorId: "member",
      workspaceId: ws,
      limit: 9999,
    });
    expect(big.items).toHaveLength(3);
    const zero = await svc().list({
      actorId: "member",
      workspaceId: ws,
      limit: 0,
    });
    expect(zero.items).toHaveLength(1);
    for (const cursor of [
      "!!!",
      "e30",
      Buffer.from("[]").toString("base64url"),
    ]) {
      await expect(
        svc().list({ actorId: "member", workspaceId: ws, cursor }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("người ngoài bị Forbidden; không thấy mục của workspace khác [F-003/AC-09]", async () => {
    await seedMany(2);
    await expect(
      svc().list({ actorId: "outsider", workspaceId: ws }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("setStatus", () => {
  it("đánh dấu đã xử lý rồi mở lại; ghi người xử lý [F-003/AC-05]", async () => {
    await sync();
    const [row] = await t.db.select().from(inboxItems);
    const s = svc();
    const done = await s.setStatus({
      actorId: "member",
      workspaceId: ws,
      itemId: row!.id,
      status: "handled",
    });
    expect(done).toMatchObject({ status: "handled" });
    const [after] = await t.db.select().from(inboxItems);
    expect(after!.handledBy).toBe("member");
    await s.setStatus({
      actorId: "member",
      workspaceId: ws,
      itemId: row!.id,
      status: "open",
    });
    const [reopened] = await t.db.select().from(inboxItems);
    expect(reopened).toMatchObject({ status: "open", handledBy: null });
  });

  it("mục của workspace khác hoặc id lạ là NotFound; trạng thái lạ là ValidationError [F-003/AC-09]", async () => {
    await sync();
    const [row] = await t.db.select().from(inboxItems);
    await expect(
      svc().setStatus({
        actorId: "outsider",
        workspaceId: ws,
        itemId: row!.id,
        status: "handled",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      svc().setStatus({
        actorId: "member",
        workspaceId: ws,
        itemId: "lạ",
        status: "handled",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      svc().setStatus({
        actorId: "member",
        workspaceId: ws,
        itemId: row!.id,
        status: "xoá" as never,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
