import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  conversations,
  evidenceBlobs,
  evidenceItems,
  messages,
  providerConnections,
  socialAccounts,
  workspaces,
} from "@/src/db/schema";
import { createMemoryBlobStore } from "@/src/evidence/blob-store";
import {
  createEvidenceService,
  MAX_EVIDENCE_BYTES,
} from "@/src/evidence/service";
import { createRetentionService } from "@/src/retention/service";

import { createTestDb } from "../db/helpers";

const NOW = new Date("2026-11-22T00:00:00Z");
const DAY = 86_400_000;
const ago = (d: number) => new Date(NOW.getTime() - d * DAY);

let t: Awaited<ReturnType<typeof createTestDb>>;
let store: ReturnType<typeof createMemoryBlobStore>;
let ws: string;
let acc: string;
let conv: string;
const svc = () => createEvidenceService({ db: t.db, store });

async function addMessage(ext: string, text: string, sentAt = ago(1)) {
  const [m] = await t.db
    .insert(messages)
    .values({
      workspaceId: ws,
      conversationId: conv,
      socialAccountId: acc,
      externalId: ext,
      direction: "incoming",
      author: "Lan",
      text,
      sentAt,
    })
    .returning();
  return m!;
}

beforeEach(async () => {
  t = await createTestDb();
  store = createMemoryBlobStore();
  const [w] = await t.db.insert(workspaces).values({ name: "A" }).returning();
  ws = w!.id;
  const [c] = await t.db
    .insert(providerConnections)
    .values({
      workspaceId: ws,
      provider: "demo",
      label: "c",
      credentialsEnc: "v1:x",
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
  const [cv] = await t.db
    .insert(conversations)
    .values({
      workspaceId: ws,
      socialAccountId: acc,
      externalId: "c1",
      participantId: "u",
      participantName: "Lan",
    })
    .returning();
  conv = cv!.id;
});
afterEach(async () => {
  await t.client.close();
});

describe("backfillMessages", () => {
  it("mỗi tin có chữ nhận đúng một bằng chứng nguồn message, trỏ về tin; chạy lại không nhân đôi", async () => {
    const m = await addMessage("m1", "Còn hàng không?");
    expect(await svc().backfillMessages({ workspaceId: ws })).toEqual({
      ingested: 1,
      failed: 0,
      more: false,
    });
    const [item] = await t.db.select().from(evidenceItems);
    expect(item).toMatchObject({
      source: "message",
      messageId: m.id,
      externalId: `${acc}:m1`,
    });
    expect(item!.observedAt).toEqual(m.sentAt);
    expect(await svc().backfillMessages({ workspaceId: ws })).toMatchObject({
      ingested: 0,
    });
    expect(await t.db.select().from(evidenceItems)).toHaveLength(1);
  });

  it("bỏ qua tin không có chữ và tin quá trần; không đánh dấu lỗi", async () => {
    await addMessage("img", "");
    await addMessage("huge", "x".repeat(MAX_EVIDENCE_BYTES + 1));
    await addMessage("ok", "xin chào");
    expect(await svc().backfillMessages({ workspaceId: ws })).toMatchObject({
      ingested: 1,
      failed: 0,
    });
  });

  it("hai tin cùng nội dung: một blob, hai bằng chứng", async () => {
    await addMessage("a", "Cảm ơn shop");
    await addMessage("b", "Cảm ơn shop");
    await svc().backfillMessages({ workspaceId: ws });
    expect(await t.db.select().from(evidenceBlobs)).toHaveLength(1);
    expect(await t.db.select().from(evidenceItems)).toHaveLength(2);
  });

  it("chia lô theo limit và báo còn", async () => {
    for (let i = 0; i < 3; i++) await addMessage(`m${i}`, `tin ${i}`);
    const r = await svc().backfillMessages({ workspaceId: ws, limit: 2 });
    expect(r).toMatchObject({ ingested: 2, more: true });
    expect(
      await svc().backfillMessages({ workspaceId: ws, limit: 2 }),
    ).toMatchObject({ ingested: 1, more: false });
  });

  it("một tin lỗi không chặn tin khác; lượt sau tự bù", async () => {
    await addMessage("a", "tin a");
    await addMessage("b", "tin b");
    const spy = vi.spyOn(store, "put").mockRejectedValueOnce(new Error("đĩa"));
    const r = await svc().backfillMessages({ workspaceId: ws });
    expect(r).toMatchObject({ ingested: 1, failed: 1 });
    spy.mockRestore();
    expect(await svc().backfillMessages({ workspaceId: ws })).toMatchObject({
      ingested: 1,
    });
    expect(await t.db.select().from(evidenceItems)).toHaveLength(2);
  });

  it("lọc theo tài khoản và không đụng workspace khác", async () => {
    await addMessage("m", "tin");
    const [w2] = await t.db
      .insert(workspaces)
      .values({ name: "B" })
      .returning();
    expect(await svc().backfillMessages({ workspaceId: w2!.id })).toMatchObject(
      { ingested: 0 },
    );
    expect(
      await svc().backfillMessages({
        workspaceId: ws,
        socialAccountId: "00000000-0000-4000-8000-000000000000",
      }),
    ).toMatchObject({ ingested: 0 });
  });
});

describe("hạn lưu đi qua kho bằng chứng (H5)", () => {
  const retention = () => createRetentionService({ db: t.db, evidence: svc() });

  it("xoá tin quá hạn thì xoá luôn bằng chứng, blob và tệp; tin còn hạn giữ nguyên", async () => {
    await addMessage("cu", "tin cũ nhạy cảm", ago(400));
    await addMessage("moi", "tin mới", ago(1));
    await svc().backfillMessages({ workspaceId: ws });
    expect(store.size).toBe(2);
    const r = await retention().purgeExpired({ now: NOW });
    expect(r).toMatchObject({ messages: 1, evidenceBlobs: 1 });
    expect(await t.db.select().from(evidenceItems)).toHaveLength(1);
    expect(await t.db.select().from(evidenceBlobs)).toHaveLength(1);
    expect(store.size).toBe(1);
  });

  it("blob còn được tin khác dùng thì giữ; tệp còn khi workspace khác dùng cùng hash", async () => {
    await addMessage("cu", "Cảm ơn shop", ago(400));
    await addMessage("moi", "Cảm ơn shop", ago(1));
    await svc().backfillMessages({ workspaceId: ws });
    const [w2] = await t.db
      .insert(workspaces)
      .values({ name: "B" })
      .returning();
    await svc().ingestAsSystem({
      workspaceId: w2!.id,
      source: "document",
      externalId: "doc",
      content: "Cảm ơn shop",
      contentType: "text/plain",
      observedAt: NOW,
    });
    const r = await retention().purgeExpired({ now: NOW });
    expect(r).toMatchObject({ messages: 1, evidenceBlobs: 0 });
    expect(store.size).toBe(1);
  });

  it("blob của workspace này mồ côi nhưng workspace khác còn dùng hash: xoá dòng, giữ tệp", async () => {
    await addMessage("cu", "nội dung chung", ago(400));
    await svc().backfillMessages({ workspaceId: ws });
    const [w2] = await t.db
      .insert(workspaces)
      .values({ name: "B" })
      .returning();
    await svc().ingestAsSystem({
      workspaceId: w2!.id,
      source: "document",
      externalId: "doc",
      content: "nội dung chung",
      contentType: "text/plain",
      observedAt: NOW,
    });
    const r = await retention().purgeExpired({ now: NOW });
    expect(r.evidenceBlobs).toBe(1);
    expect(store.size).toBe(1);
    expect(await t.db.select().from(evidenceBlobs)).toHaveLength(1);
  });

  it("workspace giữ vô thời hạn thì bằng chứng tin cũ cũng giữ", async () => {
    await t.db
      .update(workspaces)
      .set({ retainInboxForever: true })
      .where(eq(workspaces.id, ws));
    await addMessage("cu", "tin cũ", ago(4000));
    await svc().backfillMessages({ workspaceId: ws });
    const r = await retention().purgeExpired({ now: NOW });
    expect(r).toMatchObject({ messages: 0, evidenceBlobs: 0 });
    expect(await t.db.select().from(evidenceItems)).toHaveLength(1);
  });

  it("xoá tài khoản xoá theo tầng tin và bằng chứng; quét dọn blob mồ côi lũy đẳng", async () => {
    await addMessage("m", "sẽ bị xoá");
    await svc().backfillMessages({ workspaceId: ws });
    await t.db.delete(socialAccounts).where(eq(socialAccounts.id, acc));
    expect(await t.db.select().from(evidenceItems)).toHaveLength(0);
    expect(await svc().sweepOrphanBlobs()).toEqual({ blobs: 1, files: 1 });
    expect(await svc().sweepOrphanBlobs()).toEqual({ blobs: 0, files: 0 });
    expect(store.size).toBe(0);
  });
});

describe("ràng buộc DB", () => {
  it("bằng chứng nguồn message bắt buộc có message_id; nguồn khác không được có", async () => {
    const [blob] = await t.db
      .insert(evidenceBlobs)
      .values({
        workspaceId: ws,
        sha256: "a".repeat(64),
        sizeBytes: 1,
        contentType: "text/plain",
      })
      .returning();
    const m = await addMessage("m", "x");
    const row = (over: Record<string, unknown>) => ({
      workspaceId: ws,
      blobId: blob!.id,
      externalId: "e",
      observedAt: NOW,
      ...over,
    });
    await expect(
      t.db.insert(evidenceItems).values(row({ source: "message" }) as never),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      t.db
        .insert(evidenceItems)
        .values(row({ source: "document", messageId: m.id }) as never),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      svc().ingestAsSystem({
        workspaceId: ws,
        source: "message",
        externalId: "x",
        content: "x",
        contentType: "text/plain",
        observedAt: NOW,
      }),
    ).rejects.toThrow(/message/);
    expect(
      await t.db
        .select()
        .from(evidenceItems)
        .where(and(eq(evidenceItems.workspaceId, ws))),
    ).toHaveLength(0);
  });
});
