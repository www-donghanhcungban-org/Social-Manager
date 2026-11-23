import { readFileSync } from "node:fs";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  conversations,
  messages,
  providerConnections,
  socialAccounts,
  workspaces,
} from "@/src/db/schema";

import { createTestDb, MIGRATIONS, readDownSql, tableNames } from "./helpers";

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const FK_VIOLATION = "23503";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.client.close();
});

async function seed() {
  const [ws] = await t.db.insert(workspaces).values({ name: "A" }).returning();
  const [conn] = await t.db
    .insert(providerConnections)
    .values({
      workspaceId: ws!.id,
      provider: "socialapi",
      label: "chính",
      credentialsEnc: "v1:x",
    })
    .returning();
  const [acc] = await t.db
    .insert(socialAccounts)
    .values({
      connectionId: conn!.id,
      platform: "facebook",
      externalId: "acc_1",
      displayName: "Trang A",
    })
    .returning();
  const [conv] = await t.db
    .insert(conversations)
    .values({
      workspaceId: ws!.id,
      socialAccountId: acc!.id,
      externalId: "conv-1",
      participantId: "psid",
      participantName: "Lan",
    })
    .returning();
  return { ws: ws!, acc: acc!, conv: conv! };
}

const msg = (
  s: Awaited<ReturnType<typeof seed>>,
  over: Partial<typeof messages.$inferInsert> = {},
) => ({
  workspaceId: s.ws.id,
  conversationId: s.conv.id,
  socialAccountId: s.acc.id,
  externalId: "mid.1",
  direction: "incoming" as const,
  author: "Lan",
  text: "Còn hàng không?",
  sentAt: new Date("2026-11-22T09:00:00Z"),
  ...over,
});

describe("bảng conversations và messages (migration 0006)", () => {
  it("lưu tin nguyên văn dài hơn 10.000 ký tự, mặc định identity_weak = false", async () => {
    const s = await seed();
    const text = "Tiếng Việt có dấu ữ ".repeat(2000);
    const [row] = await t.db
      .insert(messages)
      .values(msg(s, { text }))
      .returning();
    expect(row!.text).toBe(text);
    expect(row!.identityWeak).toBe(false);
  });

  it("cùng tài khoản + external_id là một tin: chèn lần hai bị từ chối", async () => {
    const s = await seed();
    await t.db.insert(messages).values(msg(s));
    await expect(
      t.db.insert(messages).values(msg(s, { text: "khác" })),
    ).rejects.toMatchObject({ cause: { code: UNIQUE_VIOLATION } });
  });

  it("cùng tài khoản + id hội thoại là một hội thoại", async () => {
    const s = await seed();
    await expect(
      t.db.insert(conversations).values({
        workspaceId: s.ws.id,
        socialAccountId: s.acc.id,
        externalId: "conv-1",
        participantId: "x",
        participantName: "x",
      }),
    ).rejects.toMatchObject({ cause: { code: UNIQUE_VIOLATION } });
  });

  it("hướng tin ngoài danh sách bị từ chối", async () => {
    const s = await seed();
    await expect(
      t.db.insert(messages).values(msg(s, { direction: "sideways" as never })),
    ).rejects.toMatchObject({ cause: { code: CHECK_VIOLATION } });
  });

  it("tin trỏ tới hội thoại không có bị từ chối", async () => {
    const s = await seed();
    await expect(
      t.db
        .insert(messages)
        .values(
          msg(s, { conversationId: "00000000-0000-4000-8000-000000000000" }),
        ),
    ).rejects.toMatchObject({ cause: { code: FK_VIOLATION } });
  });

  it("xoá tài khoản mạng xã hội xoá theo tầng hội thoại và tin nhắn", async () => {
    const s = await seed();
    await t.db.insert(messages).values(msg(s));
    await t.db.delete(socialAccounts).where(eq(socialAccounts.id, s.acc.id));
    expect(await t.db.select().from(conversations)).toEqual([]);
    expect(await t.db.select().from(messages)).toEqual([]);
  });

  it("xoá workspace xoá hết hội thoại và tin nhắn của nó", async () => {
    const s = await seed();
    await t.db.insert(messages).values(msg(s));
    await t.db.delete(workspaces).where(eq(workspaces.id, s.ws.id));
    expect(await t.db.select().from(messages)).toEqual([]);
  });

  it("down migration gỡ sạch hai bảng và giữ inbox_items", async () => {
    // Lùi đúng thứ tự từ bản mới nhất tới 0006: các bản sau (vd bằng chứng trỏ vào messages) phải lùi trước.
    const tags = (
      JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as {
        entries: { tag: string }[];
      }
    ).entries.map((e) => e.tag);
    for (const tag of tags.slice(tags.indexOf("0006_conversations")).reverse())
      await t.client.exec(readDownSql(tag));
    const names = await tableNames(t.client);
    expect(names).not.toContain("conversations");
    expect(names).not.toContain("messages");
    expect(names).toContain("inbox_items");
  });
});
