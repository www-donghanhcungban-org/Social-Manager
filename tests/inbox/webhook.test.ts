import { createHmac, randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createConnectionService } from "@/src/connections/service";
import { createConversationSync } from "@/src/conversations/sync";
import { createMemoryBlobStore } from "@/src/evidence/blob-store";
import { createEvidenceService } from "@/src/evidence/service";
import {
  conversations,
  evidenceItems,
  inboxItems,
  members,
  messages,
  providerConnections,
  socialAccounts,
  workspaces,
} from "@/src/db/schema";
import { createWebhookIngest } from "@/src/inbox/webhook";
import { createRegistry } from "@/src/providers/registry";
import { createSecretBox } from "@/src/security/secret-box";

import { createTestDb } from "../db/helpers";

const box = createSecretBox(randomBytes(32).toString("base64"));
const SECRET = "w".repeat(64);
const NOW = 1_800_000_000_000;
const TS = String(NOW / 1000);

let t: Awaited<ReturnType<typeof createTestDb>>;
let wsA: string;
let wsB: string;
let connA: string;
let connB: string;
let accA: string;

const ingest = () => createWebhookIngest({ db: t.db, box, now: () => NOW });
const sign = (body: string, ts = TS, secret = SECRET) =>
  `sha256=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;
const call = (
  body: string,
  over: Partial<{
    connectionId: string;
    timestamp: string;
    signature: string | null;
  }> = {},
) =>
  ingest().handle({
    connectionId: connA,
    rawBody: Buffer.from(body),
    timestamp: TS,
    signature: sign(body),
    ...over,
  });

const dm = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    event: "dm.received",
    data: {
      id: "sapi_dm_1",
      platform: "instagram",
      author: { id: "u1", name: "Lan" },
      content: { text: "Chào shop" },
      received_at: "2026-11-22T08:00:00Z",
      account_id: "acc_A",
      ...over,
    },
  });

beforeEach(async () => {
  t = await createTestDb();
  const [a] = await t.db.insert(workspaces).values({ name: "A" }).returning();
  const [b] = await t.db.insert(workspaces).values({ name: "B" }).returning();
  wsA = a!.id;
  wsB = b!.id;
  await t.db.insert(members).values([
    { workspaceId: wsA, userId: "ownerA", role: "owner" },
    { workspaceId: wsB, userId: "ownerB", role: "owner" },
  ]);
  const mk = async (workspaceId: string, provider: string, label: string) => {
    const [c] = await t.db
      .insert(providerConnections)
      .values({
        workspaceId,
        provider,
        label,
        credentialsEnc: box.encrypt("KHOA"),
      })
      .returning();
    return c!.id;
  };
  connA = await mk(wsA, "socialapi", "A");
  connB = await mk(wsB, "socialapi", "B");
  const [acc] = await t.db
    .insert(socialAccounts)
    .values({
      connectionId: connA,
      platform: "instagram",
      externalId: "acc_A",
      displayName: "Trang A",
    })
    .returning();
  accA = acc!.id;
  await t.db.insert(socialAccounts).values({
    connectionId: connB,
    platform: "instagram",
    externalId: "acc_B",
    displayName: "Trang B",
  });
  await createConnectionService({
    db: t.db,
    box,
    registry: createRegistry(),
  }).setWebhookSecret({
    actorId: "ownerA",
    workspaceId: wsA,
    connectionId: connA,
    secret: SECRET,
  });
});
afterEach(async () => {
  await t.client.close();
});

describe("nhận webhook", () => {
  it("chữ ký đúng → nhập tin vào đúng workspace/tài khoản, 200 [F-003/AC-06]", async () => {
    const r = await call(dm());
    expect(r).toEqual({ status: 200, body: { status: "ok", inserted: 1 } });
    const [row] = await t.db.select().from(inboxItems);
    expect(row).toMatchObject({
      workspaceId: wsA,
      socialAccountId: accA,
      kind: "dm",
      externalId: "sapi_dm_1",
      author: "Lan",
      text: "Chào shop",
      status: "open",
    });
    expect(row!.receivedAt.toISOString()).toBe("2026-11-22T08:00:00.000Z");
  });

  it("gửi lại cùng delivery (SocialAPI giao ít nhất một lần) → không trùng, vẫn 200 [F-003/AC-06] [F-003/AC-02]", async () => {
    await call(dm());
    const again = await call(dm());
    expect(again).toEqual({ status: 200, body: { status: "ok", inserted: 0 } });
    expect(await t.db.select().from(inboxItems)).toHaveLength(1);
  });

  it("tin đã được đánh dấu xử lý không bị mở lại khi nhận trùng [F-003/AC-06]", async () => {
    await call(dm());
    await t.db.update(inboxItems).set({ status: "handled" });
    await call(dm());
    const [row] = await t.db.select().from(inboxItems);
    expect(row!.status).toBe("handled");
  });

  it("sự kiện không thuộc hộp thư → 200 bỏ qua, không ghi gì [F-003/AC-06]", async () => {
    const body = JSON.stringify({ event: "post.published", data: {} });
    expect(await call(body)).toEqual({
      status: 200,
      body: { status: "ignored" },
    });
    expect(await t.db.select().from(inboxItems)).toHaveLength(0);
  });

  it("tài khoản không thuộc kết nối này → 200 bỏ qua (thử lại cũng vô ích), không ghi vào workspace khác", async () => {
    const r = await call(dm({ account_id: "acc_B" }));
    expect(r).toEqual({ status: 200, body: { status: "ignored" } });
    expect(await t.db.select().from(inboxItems)).toHaveLength(0);
  });
});

describe("từ chối (không lộ kết nối nào tồn tại)", () => {
  const unauthorized = { status: 401, body: { status: "unauthorized" } };

  it("sai chữ ký, thiếu chữ ký, timestamp cũ → cùng một phản hồi 401, không ghi gì [F-003/AC-07]", async () => {
    expect(
      await call(dm(), { signature: sign(dm(), TS, "x".repeat(64)) }),
    ).toEqual(unauthorized);
    expect(await call(dm(), { signature: null })).toEqual(unauthorized);
    const old = String(NOW / 1000 - 400);
    expect(
      await call(dm(), { timestamp: old, signature: sign(dm(), old) }),
    ).toEqual(unauthorized);
    expect(await t.db.select().from(inboxItems)).toHaveLength(0);
  });

  it("kết nối không tồn tại, id không phải UUID, kết nối chưa bật webhook, kết nối provider khác → đều 401 giống nhau [F-003/AC-07]", async () => {
    const [demo] = await t.db
      .insert(providerConnections)
      .values({
        workspaceId: wsA,
        provider: "demo",
        label: "demo",
        credentialsEnc: box.encrypt("k"),
        webhookSecretEnc: box.encrypt(SECRET),
      })
      .returning();
    for (const connectionId of [
      "00000000-0000-4000-8000-000000000000",
      "khong-phai-uuid",
      "",
      connB, // có thật nhưng chưa đặt secret
      demo!.id, // đã có secret nhưng không phải socialapi
    ])
      expect(await call(dm(), { connectionId }), connectionId).toEqual(
        unauthorized,
      );
  });

  it("secret của kết nối B không dùng được cho kết nối A (chữ ký chéo) [F-003/AC-07]", async () => {
    await createConnectionService({
      db: t.db,
      box,
      registry: createRegistry(),
    }).setWebhookSecret({
      actorId: "ownerB",
      workspaceId: wsB,
      connectionId: connB,
      secret: "b".repeat(64),
    });
    const r = await call(dm(), { signature: sign(dm(), TS, "b".repeat(64)) });
    expect(r.status).toBe(401);
  });

  it("thân quá lớn → 413 trước khi chạm CSDL [F-003/AC-08]", async () => {
    const big = "x".repeat(300_000);
    expect((await call(big, { signature: sign(big) })).status).toBe(413);
  });

  it("chữ ký đúng nhưng thân hỏng → 400 (JSON hỏng, thiếu trường, thời gian sai) [F-003/AC-08]", async () => {
    for (const body of [
      "{không phải json",
      "[]",
      dm({ id: "" }),
      dm({ received_at: "hôm qua" }),
    ])
      expect((await call(body)).status, body).toBe(400);
    expect(await t.db.select().from(inboxItems)).toHaveLength(0);
  });
});

describe("đặt secret webhook (setWebhookSecret) [F-002/AC-10]", () => {
  const svc = () =>
    createConnectionService({ db: t.db, box, registry: createRegistry() });

  it("lưu bản mã, không bao giờ trả giá trị; bật cờ webhookEnabled", async () => {
    const [row] = await t.db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.id, connA));
    expect(row!.webhookSecretEnc).not.toBeNull();
    expect(row!.webhookSecretEnc).not.toContain(SECRET);
    const list = await svc().list({ actorId: "ownerA", workspaceId: wsA });
    expect(list[0]!.webhookEnabled).toBe(true);
    expect(JSON.stringify(list)).not.toContain(SECRET);
  });

  it("xoá secret (null) thì webhook ngừng nhận", async () => {
    await svc().setWebhookSecret({
      actorId: "ownerA",
      workspaceId: wsA,
      connectionId: connA,
      secret: null,
    });
    expect((await call(dm())).status).toBe(401);
  });

  it("từ chối secret ngắn, quá dài, có khoảng trắng", async () => {
    for (const secret of [
      "ngan",
      "x".repeat(300),
      "co khoang trang 1234567890",
      " " + "x".repeat(20),
    ])
      await expect(
        svc().setWebhookSecret({
          actorId: "ownerA",
          workspaceId: wsA,
          connectionId: connA,
          secret,
        }),
      ).rejects.toThrow(/Secret webhook/);
  });

  it("chỉ người quản lý kết nối của đúng workspace được đặt (member, người ngoài, workspace khác)", async () => {
    await t.db
      .insert(members)
      .values({ workspaceId: wsA, userId: "memA", role: "member" });
    const attempt = (actorId: string, workspaceId: string) =>
      svc().setWebhookSecret({
        actorId,
        workspaceId,
        connectionId: connA,
        secret: "z".repeat(40),
      });
    await expect(attempt("memA", wsA)).rejects.toThrow();
    await expect(attempt("ownerB", wsA)).rejects.toThrow();
    await expect(attempt("ownerB", wsB)).rejects.toThrow(); // connA không thuộc wsB → NotFound
  });
});

describe("dm.received theo hội thoại (cùng khoá với đồng bộ)", () => {
  const withConv = (over: Record<string, unknown> = {}) =>
    dm({ conversation_id: "conv-1", platform_id: "mid.1", ...over });

  /** Đồng bộ giả trả đúng tin mà webhook đã/ sẽ báo (cùng platform_id). */
  const syncOnce = () =>
    createConversationSync({ db: t.db, errorCode: () => "x" }).syncAccount(
      wsA,
      { id: accA, externalId: "acc_A", platform: "instagram" },
      {
        id: "fake",
        label: "fake",
        support: { instagram: ["dm"] },
        listConversations: async () => ({
          items: [
            {
              id: "conv-1",
              participantId: "u1",
              participantName: "Lan",
              lastMessageAt: "2026-11-22T08:00:00Z",
            },
          ],
          nextCursor: null,
        }),
        listMessages: async () => ({
          items: [
            {
              id: "mid.1",
              identityWeak: false,
              providerMessageId: "uuid-1",
              direction: "incoming",
              author: "Lan",
              text: "Chào shop",
              sentAt: "2026-11-22T08:00:00Z",
            },
          ],
          nextCursor: null,
        }),
      },
    );
  const all = async () => ({
    msgs: await t.db.select().from(messages),
    convs: await t.db.select().from(conversations),
    items: await t.db.select().from(inboxItems),
  });

  it("ghi tin theo platform_id, hội thoại và mục hộp thư khoá theo conversation_id; nội dung không cắt", async () => {
    const long = "x".repeat(12_000);
    expect(
      (await call(withConv({ content: { text: long } }))).body,
    ).toMatchObject({ status: "ok", inserted: 1 });
    const { msgs, convs, items } = await all();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      externalId: "mid.1",
      identityWeak: false,
      providerMessageId: "sapi_dm_1",
      direction: "incoming",
    });
    expect(msgs[0]!.text).toHaveLength(12_000);
    expect(convs[0]).toMatchObject({
      externalId: "conv-1",
      participantId: "u1",
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "dm", externalId: "conv-1" });
    expect(items[0]!.text).toHaveLength(10_000);
  });

  it("webhook trước rồi đồng bộ: chỉ một tin, một mục [F-003/AC-02]", async () => {
    await call(withConv());
    const r = await syncOnce();
    expect(r.messages).toBe(0);
    const { msgs, items } = await all();
    expect(msgs).toHaveLength(1);
    expect(items).toHaveLength(1);
  });

  it("đồng bộ trước rồi webhook: chỉ một tin, mục đã xử lý không bị mở lại vì tin cũ [F-003/AC-02]", async () => {
    await syncOnce();
    await t.db
      .update(inboxItems)
      .set({ status: "handled", handledBy: "ownerA" });
    expect((await call(withConv())).body).toMatchObject({ inserted: 0 });
    const { msgs, items } = await all();
    expect(msgs).toHaveLength(1);
    expect(items[0]!.status).toBe("handled");
  });

  it("giao trùng cùng sự kiện: không nhân đôi", async () => {
    await call(withConv());
    expect((await call(withConv())).body).toMatchObject({ inserted: 0 });
    expect((await all()).msgs).toHaveLength(1);
  });

  it("tin đến mới hơn qua webhook mở lại mục đã xử lý", async () => {
    await call(withConv());
    await t.db
      .update(inboxItems)
      .set({ status: "handled", handledBy: "ownerA" });
    await call(
      withConv({
        id: "sapi_dm_2",
        platform_id: "mid.2",
        received_at: "2026-11-22T09:00:00Z",
        content: { text: "Còn không?" },
      }),
    );
    const { items, convs } = await all();
    expect(items[0]).toMatchObject({ status: "open", text: "Còn không?" });
    expect(convs[0]!.lastMessageAt!.toISOString()).toBe(
      "2026-11-22T09:00:00.000Z",
    );
  });

  it("có dịch vụ bằng chứng: tin vào kho một lần; giao trùng không nhân đôi", async () => {
    const evidence = createEvidenceService({
      db: t.db,
      store: createMemoryBlobStore(),
    });
    const handle = () =>
      createWebhookIngest({ db: t.db, box, now: () => NOW, evidence }).handle({
        connectionId: connA,
        rawBody: Buffer.from(withConv()),
        timestamp: TS,
        signature: sign(withConv()),
      });
    expect((await handle()).status).toBe(200);
    expect((await handle()).status).toBe(200);
    const items = await t.db.select().from(evidenceItems);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: "message" });
  });

  it("thiếu platform_id: dùng data.id, đánh dấu định danh yếu", async () => {
    await call(withConv({ platform_id: undefined }));
    expect((await all()).msgs[0]).toMatchObject({
      externalId: "sapi_dm_1",
      identityWeak: true,
    });
  });

  it("thiếu conversation_id (Zalo): giữ cách cũ, không ghi bảng tin nhắn", async () => {
    await call(dm());
    const { msgs, convs, items } = await all();
    expect(msgs).toEqual([]);
    expect(convs).toEqual([]);
    expect(items[0]).toMatchObject({ externalId: "sapi_dm_1" });
  });

  it("conversation_id sai kiểu là 400", async () => {
    expect((await call(withConv({ conversation_id: 42 }))).status).toBe(400);
    expect((await all()).msgs).toEqual([]);
  });
});
