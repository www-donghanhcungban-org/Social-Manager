import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createThreadService } from "@/src/conversations/threads";
import { ForbiddenError, NotFoundError } from "@/src/auth/errors";
import { conversations, members, messages, workspaces } from "@/src/db/schema";
import { ValidationError } from "@/src/providers/types";

import { type Env, H, NOW, setup } from "../actions/helpers";

let e: Env;
let svc: ReturnType<typeof createThreadService>;
beforeEach(async () => {
  e = await setup();
  svc = createThreadService({ db: e.t.db });
});
afterEach(async () => {
  await e.t.client.close();
});

const M = () => ({ actorId: "member", workspaceId: e.ws });
const at = (h: number) => new Date(NOW.getTime() - h * H);

async function conv(name: string, last: Date | null) {
  const [c] = await e.t.db
    .insert(conversations)
    .values({
      workspaceId: e.ws,
      socialAccountId: e.account,
      externalId: `x-${name}`,
      participantId: name,
      participantName: name,
      lastMessageAt: last,
    })
    .returning();
  return c!.id;
}

async function addTo(
  conversationId: string,
  over: Partial<typeof messages.$inferInsert>,
) {
  await e.t.db.insert(messages).values({
    workspaceId: e.ws,
    conversationId,
    socialAccountId: e.account,
    externalId: `e-${crypto.randomUUID()}`,
    direction: "incoming",
    author: "Lan",
    text: "x",
    sentAt: at(1),
    ...over,
  });
}

describe("danh sách hội thoại", () => {
  it("mới hoạt động nhất trước; chưa có tin (null) xếp cuối; kèm tên tài khoản và nền tảng [F-006/AC-01]", async () => {
    await conv("cu", at(5));
    await conv("moi", at(1));
    await conv("trong", null);
    const r = await svc.list(M());
    expect(r.items.slice(0, 2).map((i) => i.participantName)).toEqual([
      "moi",
      "cu",
    ]);
    expect(r.items).toHaveLength(4);
    expect(r.items[0]).toMatchObject({
      participantName: "moi",
      accountName: "Trang",
      platform: "facebook",
    });
    expect(r.items.slice(-2).every((i) => i.lastMessageAt === null)).toBe(true);
    expect(r.nextCursor).toBeNull();
  });

  it("phân trang bằng con trỏ: không lặp, không sót, kể cả cùng thời điểm và null [F-006/AC-01]", async () => {
    for (let i = 0; i < 3; i++) await conv(`same${i}`, at(2)); // cùng mốc: phá hoà bằng id
    await conv("n1", null);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const r = await svc.list({ ...M(), limit: 2, cursor });
      seen.push(...r.items.map((i) => i.id));
      if (!r.nextCursor) break;
      cursor = r.nextCursor;
    }
    expect(seen).toHaveLength(5); // 3 + n1 + hội thoại của helper
    expect(new Set(seen).size).toBe(5);
  });

  it("con trỏ hỏng bị từ chối; chỉ thấy hội thoại của workspace mình; người ngoài bị cấm [F-006/AC-11]", async () => {
    for (const bad of [
      "",
      "abc",
      "1.zzz",
      "-5.00000000-0000-4000-8000-000000000000",
    ])
      await expect(svc.list({ ...M(), cursor: bad })).rejects.toBeInstanceOf(
        ValidationError,
      );
    const [w2] = await e.t.db
      .insert(workspaces)
      .values({ name: "B" })
      .returning();
    await e.t.db
      .insert(members)
      .values({ workspaceId: w2!.id, userId: "other", role: "owner" });
    expect(
      (await svc.list({ actorId: "other", workspaceId: w2!.id })).items,
    ).toEqual([]);
    await expect(
      svc.list({ actorId: "other", workspaceId: e.ws }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      svc.list({ actorId: "lạ", workspaceId: e.ws }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("trần số dòng: limit quá lớn hoặc không hợp lệ được kẹp [F-006/AC-01]", async () => {
    const r = await svc.list({ ...M(), limit: 100000 });
    expect(r.items.length).toBeLessThanOrEqual(100);
    expect((await svc.list({ ...M(), limit: Number.NaN })).items.length).toBe(
      1,
    );
  });
});

describe("một cuộc trò chuyện", () => {
  it("tin xếp cũ → mới, đúng hướng; hội thoại rỗng trả mảng rỗng [F-006/AC-01]", async () => {
    const c = await conv("tt", at(0.5));
    await addTo(c, {
      direction: "outgoing",
      author: "Shop",
      text: "Dạ còn",
      sentAt: at(0.5),
    });
    await addTo(c, { text: "Còn hàng?", sentAt: at(1) });
    const t = await svc.get({ ...M(), conversationId: c });
    expect(t.messages.map((m) => m.text)).toEqual(["Còn hàng?", "Dạ còn"]);
    expect(t.messages.map((m) => m.direction)).toEqual([
      "incoming",
      "outgoing",
    ]);
    expect(t.truncated).toBe(false);
    const empty = await svc.get({
      ...M(),
      conversationId: await conv("rong", null),
    });
    expect(empty.messages).toEqual([]);
    expect(empty.drafts).toEqual([]);
    expect(empty.actions).toEqual([]);
  });

  it("cắt theo trần: lấy tin MỚI NHẤT và báo truncated [F-006/AC-01]", async () => {
    const c = await conv("cat", at(1));
    for (let i = 0; i < 5; i++)
      await addTo(c, { text: `tin ${i}`, sentAt: at(10 - i) });
    const t = await svc.get({ ...M(), conversationId: c, limit: 3 });
    expect(t.truncated).toBe(true);
  });

  it("kèm nháp (nội dung phiên bản hiện tại) và hành động gửi của nháp [F-006/AC-01]", async () => {
    const d = await e.draft("Dạ còn ạ");
    await e.drafts.edit({
      ...M(),
      draftId: d,
      baseVersion: 1,
      text: "Dạ còn hàng ạ",
    });
    const a = await e.actions.requestSend({
      ...M(),
      draftId: d,
      idempotencyKey: "k",
    });
    const t = await svc.get({ ...M(), conversationId: e.conv });
    expect(t.drafts).toHaveLength(1);
    expect(t.drafts[0]).toMatchObject({
      id: d,
      currentVersion: 2,
      text: "Dạ còn hàng ạ",
    });
    expect(t.actions.map((x) => x.id)).toEqual([a.id]);
    expect(t.actions[0]!.state).toBe(a.state);
  });

  it("id lạ, sai định dạng hoặc thuộc workspace khác là NotFound; người ngoài bị cấm [F-006/AC-11]", async () => {
    for (const id of ["lạ", "00000000-0000-4000-8000-000000000000"])
      await expect(
        svc.get({ ...M(), conversationId: id }),
      ).rejects.toBeInstanceOf(NotFoundError);
    const [w2] = await e.t.db
      .insert(workspaces)
      .values({ name: "B" })
      .returning();
    await e.t.db
      .insert(members)
      .values({ workspaceId: w2!.id, userId: "other", role: "owner" });
    await expect(
      svc.get({
        actorId: "other",
        workspaceId: w2!.id,
        conversationId: e.conv,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      svc.get({ actorId: "other", workspaceId: e.ws, conversationId: e.conv }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
