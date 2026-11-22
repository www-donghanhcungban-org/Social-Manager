import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  conversations,
  inboxItems,
  loginThrottle,
  members,
  messages,
  providerConnections,
  session,
  socialAccounts,
  user,
  verification,
  workspaces,
} from "@/src/db/schema";
import { createRetentionService } from "@/src/retention/service";
import { createSecretBox } from "@/src/security/secret-box";

import { createTestDb } from "../db/helpers";

const box = createSecretBox(randomBytes(32).toString("base64"));
const NOW = new Date("2026-11-22T00:00:00.000Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

let t: Awaited<ReturnType<typeof createTestDb>>;
let ws: string;
let acc: string;
const svc = () => createRetentionService({ db: t.db });

async function seedItem(ext: string, receivedAt: Date) {
  await t.db.insert(inboxItems).values({
    workspaceId: ws,
    socialAccountId: acc,
    kind: "dm",
    externalId: ext,
    author: "Lan",
    text: "xin chào",
    receivedAt,
  });
}

beforeEach(async () => {
  t = await createTestDb();
  const [w] = await t.db.insert(workspaces).values({ name: "A" }).returning();
  ws = w!.id;
  await t.db
    .insert(members)
    .values({ workspaceId: ws, userId: "u1", role: "owner" });
  const [c] = await t.db
    .insert(providerConnections)
    .values({
      workspaceId: ws,
      provider: "demo",
      label: "c",
      credentialsEnc: box.encrypt("k"),
    })
    .returning();
  const [a] = await t.db
    .insert(socialAccounts)
    .values({
      connectionId: c!.id,
      platform: "facebook",
      externalId: "p",
      displayName: "P",
    })
    .returning();
  acc = a!.id;
});
afterEach(async () => {
  await t.client.close();
});

describe("tin hộp thư quá hạn lưu (365 ngày)", () => {
  it("xoá tin cũ hơn hạn, giữ tin còn trong hạn (kể cả sát ranh giới)", async () => {
    await seedItem("cu", ago(366));
    await seedItem("sat-hạn-trong", ago(364));
    await seedItem("moi", ago(1));
    const r = await svc().purgeExpired({ now: NOW });
    expect(r.inboxItems).toBe(1);
    const left = (await t.db.select().from(inboxItems)).map(
      (i) => i.externalId,
    );
    expect(left.sort()).toEqual(["moi", "sat-hạn-trong"]);
  });

  it("chạy lại lần hai không xoá thêm (lũy đẳng)", async () => {
    await seedItem("cu", ago(400));
    await svc().purgeExpired({ now: NOW });
    expect((await svc().purgeExpired({ now: NOW })).inboxItems).toBe(0);
  });

  it("mỗi lần chỉ xoá tối đa một lô, lô sau xoá tiếp (không khoá bảng lâu)", async () => {
    for (let i = 0; i < 5; i++) await seedItem(`cu${i}`, ago(500 + i));
    const r = await svc().purgeExpired({ now: NOW, batchSize: 2 });
    expect(r.inboxItems).toBe(2);
    expect(r.more).toBe(true);
    expect(await t.db.select().from(inboxItems)).toHaveLength(3);
  });

  it("hạn lưu cấu hình được và phải là số nguyên dương", async () => {
    await seedItem("a", ago(40));
    expect(
      (await svc().purgeExpired({ now: NOW, inboxDays: 30 })).inboxItems,
    ).toBe(1);
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      await expect(
        svc().purgeExpired({ now: NOW, inboxDays: bad }),
      ).rejects.toThrow(/inboxDays/);
    }
  });
});

describe("tin nhắn theo hội thoại quá hạn lưu", () => {
  async function seedConv(ext: string, lastMessageAt: Date | null) {
    const [c] = await t.db
      .insert(conversations)
      .values({
        workspaceId: ws,
        socialAccountId: acc,
        externalId: ext,
        participantId: "psid",
        participantName: "Lan",
        lastMessageAt,
        createdAt: ago(800),
      })
      .returning();
    return c!.id;
  }
  const seedMsg = (conversationId: string, ext: string, sentAt: Date) =>
    t.db.insert(messages).values({
      workspaceId: ws,
      conversationId,
      socialAccountId: acc,
      externalId: ext,
      direction: "incoming",
      author: "Lan",
      text: "x",
      sentAt,
    });

  it("xoá tin cũ hơn hạn theo sent_at, giữ tin trong hạn và hội thoại còn tin mới", async () => {
    const c = await seedConv("c1", ago(1));
    await seedMsg(c, "cu", ago(366));
    await seedMsg(c, "moi", ago(1));
    const r = await svc().purgeExpired({ now: NOW });
    expect(r.messages).toBe(1);
    expect(r.conversations).toBe(0);
    expect(
      (await t.db.select().from(messages)).map((m) => m.externalId),
    ).toEqual(["moi"]);
  });

  it("hội thoại không còn tin trong hạn bị xoá (cả khi last_message_at rỗng)", async () => {
    const c = await seedConv("c-cu", ago(400));
    await seedMsg(c, "cu", ago(400));
    await seedConv("c-rong", null);
    const keep = await seedConv("c-moi", ago(2));
    const r = await svc().purgeExpired({ now: NOW });
    expect(r.conversations).toBe(2);
    expect((await t.db.select().from(conversations)).map((x) => x.id)).toEqual([
      keep,
    ]);
  });

  it("last_message_at lệch cũ nhưng còn tin trong hạn thì giữ hội thoại", async () => {
    const c = await seedConv("c", ago(500));
    await seedMsg(c, "moi", ago(3));
    expect((await svc().purgeExpired({ now: NOW })).conversations).toBe(0);
  });

  it("tin nhắn cũng xoá theo lô và báo còn", async () => {
    const c = await seedConv("c", ago(1));
    for (let i = 0; i < 3; i++) await seedMsg(c, `cu${i}`, ago(400 + i));
    const r = await svc().purgeExpired({ now: NOW, batchSize: 2 });
    expect(r.messages).toBe(2);
    expect(r.more).toBe(true);
  });
});

describe("thời hạn lưu theo workspace (D-010)", () => {
  async function otherWorkspace(
    over: Partial<typeof workspaces.$inferInsert> = {},
  ) {
    const [w] = await t.db
      .insert(workspaces)
      .values({ name: "B", ...over })
      .returning();
    const [c] = await t.db
      .insert(providerConnections)
      .values({
        workspaceId: w!.id,
        provider: "demo",
        label: "c",
        credentialsEnc: box.encrypt("k"),
      })
      .returning();
    const [a] = await t.db
      .insert(socialAccounts)
      .values({
        connectionId: c!.id,
        platform: "facebook",
        externalId: "q",
        displayName: "Q",
      })
      .returning();
    return { ws: w!.id, acc: a!.id };
  }
  const item = (
    workspaceId: string,
    socialAccountId: string,
    ext: string,
    d: number,
  ) =>
    t.db.insert(inboxItems).values({
      workspaceId,
      socialAccountId,
      kind: "dm",
      externalId: ext,
      author: "Lan",
      text: "x",
      receivedAt: ago(d),
    });
  const left = async () =>
    (await t.db.select().from(inboxItems)).map((i) => i.externalId).sort();

  it("mỗi workspace áp số ngày của mình; null dùng mặc định 365", async () => {
    await t.db
      .update(workspaces)
      .set({ inboxRetentionDays: 30 })
      .where(eq(workspaces.id, ws));
    const b = await otherWorkspace();
    await item(ws, acc, "a-40", 40);
    await item(ws, acc, "a-20", 20);
    await item(b.ws, b.acc, "b-40", 40);
    await item(b.ws, b.acc, "b-400", 400);
    const r = await svc().purgeExpired({ now: NOW });
    expect(r.inboxItems).toBe(2);
    expect(await left()).toEqual(["a-20", "b-40"]);
  });

  it("giữ vô thời hạn: không xoá tin, tin nhắn, hội thoại của workspace đó; phiên hết hạn vẫn dọn", async () => {
    const b = await otherWorkspace({
      retainInboxForever: true,
      inboxRetentionDays: 1,
    });
    await item(b.ws, b.acc, "b-cu", 5000);
    await item(ws, acc, "a-cu", 5000);
    const [conv] = await t.db
      .insert(conversations)
      .values({
        workspaceId: b.ws,
        socialAccountId: b.acc,
        externalId: "c",
        participantId: "p",
        participantName: "Lan",
        lastMessageAt: ago(5000),
        createdAt: ago(5000),
      })
      .returning();
    await t.db.insert(messages).values({
      workspaceId: b.ws,
      conversationId: conv!.id,
      socialAccountId: b.acc,
      externalId: "m",
      direction: "incoming",
      author: "Lan",
      text: "x",
      sentAt: ago(5000),
    });
    await t.db.insert(user).values({
      id: "u9",
      name: "x",
      email: "x@example.com",
      emailVerified: false,
    });
    await t.db.insert(session).values({
      id: "s",
      token: "t",
      userId: "u9",
      expiresAt: ago(3),
      createdAt: ago(10),
      updatedAt: ago(10),
    });
    const r = await svc().purgeExpired({ now: NOW });
    expect(await left()).toEqual(["b-cu"]);
    expect(r).toMatchObject({ messages: 0, conversations: 0, sessions: 1 });
    expect(await t.db.select().from(messages)).toHaveLength(1);
  });

  it("CSDL từ chối số ngày 0, âm hoặc quá 36500", async () => {
    for (const bad of [0, -1, 36_501]) {
      await expect(
        t.db
          .update(workspaces)
          .set({ inboxRetentionDays: bad })
          .where(eq(workspaces.id, ws)),
      ).rejects.toMatchObject({ cause: { code: "23514" } });
    }
  });
});

describe("phiên và dữ liệu xác thực hết hạn", () => {
  async function seedUser() {
    await t.db.insert(user).values({
      id: "u1",
      name: "Lan",
      email: "lan@example.com",
      emailVerified: false,
    });
  }

  it("xoá phiên đã hết hạn quá 1 ngày, giữ phiên còn hạn và phiên vừa hết", async () => {
    await seedUser();
    const base = {
      userId: "u1",
      createdAt: ago(10),
      updatedAt: ago(10),
    };
    await t.db.insert(session).values([
      { id: "s-cu", token: "t1", expiresAt: ago(3), ...base },
      {
        id: "s-vua-het",
        token: "t2",
        expiresAt: new Date(NOW.getTime() - 3600_000),
        ...base,
      },
      {
        id: "s-con",
        token: "t3",
        expiresAt: new Date(NOW.getTime() + DAY),
        ...base,
      },
    ]);
    const r = await svc().purgeExpired({ now: NOW });
    expect(r.sessions).toBe(1);
    expect((await t.db.select().from(session)).map((s) => s.id).sort()).toEqual(
      ["s-con", "s-vua-het"],
    );
  });

  it("xoá mã xác minh hết hạn và bộ đếm đăng nhập cũ hơn 24 giờ", async () => {
    await t.db.insert(verification).values([
      { id: "v1", identifier: "a", value: "x", expiresAt: ago(3) },
      {
        id: "v2",
        identifier: "b",
        value: "y",
        expiresAt: new Date(NOW.getTime() + DAY),
      },
    ]);
    await t.db.insert(loginThrottle).values([
      { keyHash: "cu", failures: 9, updatedAt: ago(2) },
      {
        keyHash: "moi",
        failures: 3,
        updatedAt: new Date(NOW.getTime() - 3600_000),
      },
    ]);
    const r = await svc().purgeExpired({ now: NOW });
    expect(r.verifications).toBe(1);
    expect(r.loginThrottle).toBe(1);
    expect(
      (await t.db.select().from(loginThrottle)).map((x) => x.keyHash),
    ).toEqual(["moi"]);
  });
});
