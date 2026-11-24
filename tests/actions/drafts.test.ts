import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/src/auth/errors";
import { createDraftService, MAX_DRAFT_CHARS } from "@/src/actions/drafts";
import {
  conversations,
  draftVersions,
  drafts,
  members,
  providerConnections,
  socialAccounts,
  workspaces,
} from "@/src/db/schema";
import { ValidationError } from "@/src/providers/types";

import { createTestDb } from "../db/helpers";

let t: Awaited<ReturnType<typeof createTestDb>>;
let ws: string;
let wsB: string;
let conv: string;
let convB: string;
const svc = () => createDraftService({ db: t.db });
const M = { actorId: "member", workspaceId: "" };

async function conversation(workspaceId: string, ext: string) {
  const [c] = await t.db
    .insert(providerConnections)
    .values({
      workspaceId,
      provider: "demo",
      label: `c${ext}`,
      credentialsEnc: "v1:x",
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
  const [cv] = await t.db
    .insert(conversations)
    .values({
      workspaceId,
      socialAccountId: a!.id,
      externalId: `conv-${ext}`,
      participantId: "u",
      participantName: "Lan",
    })
    .returning();
  return cv!.id;
}
const create = (text = "Dạ còn ạ", over: Record<string, unknown> = {}) =>
  svc().create({ ...M, conversationId: conv, text, ...over });

beforeEach(async () => {
  t = await createTestDb();
  const [a] = await t.db.insert(workspaces).values({ name: "A" }).returning();
  const [b] = await t.db.insert(workspaces).values({ name: "B" }).returning();
  ws = a!.id;
  wsB = b!.id;
  M.workspaceId = ws;
  await t.db.insert(members).values([
    { workspaceId: ws, userId: "member", role: "member" },
    { workspaceId: ws, userId: "other", role: "member" },
    { workspaceId: wsB, userId: "outsider", role: "owner" },
  ]);
  conv = await conversation(ws, "pa");
  convB = await conversation(wsB, "pb");
});
afterEach(async () => {
  await t.client.close();
});

describe("bản nháp", () => {
  it("member soạn được; nháp mới ở phiên bản 1, nguồn human, trạng thái open; chuẩn hoá NFC [F-006/AC-02]", async () => {
    const d = await create("  Dạ còn hàng ạ ".normalize("NFD"));
    expect(d).toMatchObject({
      conversationId: conv,
      status: "open",
      currentVersion: 1,
      text: "Dạ còn hàng ạ",
      source: "human",
      createdBy: "member",
    });
  });

  it("mỗi lần sửa tạo phiên bản mới, giữ nguyên lịch sử; có thể đánh dấu nguồn ai [F-006/AC-02]", async () => {
    const d = await create("bản một");
    const d2 = await svc().edit({
      ...M,
      draftId: d.id,
      baseVersion: 1,
      text: "bản hai",
    });
    const d3 = await svc().edit({
      ...M,
      actorId: "other",
      draftId: d.id,
      baseVersion: 2,
      text: "bản ba",
      source: "ai",
    });
    expect([d2.currentVersion, d3.currentVersion]).toEqual([2, 3]);
    const full = await svc().get({ ...M, draftId: d.id });
    expect(full.text).toBe("bản ba");
    expect(
      full.versions.map((v) => [v.version, v.text, v.source, v.createdBy]),
    ).toEqual([
      [1, "bản một", "human", "member"],
      [2, "bản hai", "human", "member"],
      [3, "bản ba", "ai", "other"],
    ]);
  });

  it("hai người sửa cùng phiên bản nền: chỉ một thắng, người kia nhận xung đột, không mất bản nào [F-006/AC-03]", async () => {
    const d = await create("gốc");
    const results = await Promise.allSettled([
      svc().edit({ ...M, draftId: d.id, baseVersion: 1, text: "của member" }),
      svc().edit({
        ...M,
        actorId: "other",
        draftId: d.id,
        baseVersion: 1,
        text: "của other",
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ConflictError);
    expect(lost.reason.reason).toBe("version_conflict");
    const versions = await t.db
      .select()
      .from(draftVersions)
      .where(eq(draftVersions.draftId, d.id));
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2]);
  });

  it("sửa dựa vào phiên bản cũ bị xung đột; thông báo nêu phiên bản hiện tại [F-006/AC-03]", async () => {
    const d = await create();
    await svc().edit({ ...M, draftId: d.id, baseVersion: 1, text: "mới" });
    await expect(
      svc().edit({ ...M, draftId: d.id, baseVersion: 1, text: "cũ" }),
    ).rejects.toMatchObject({
      reason: "version_conflict",
      message: expect.stringContaining("phiên bản 2"),
    });
  });

  it("nháp đã bỏ hoặc đã gửi không sửa được và không bỏ lại được [F-006/AC-03]", async () => {
    const d = await create();
    const off = await svc().discard({ ...M, draftId: d.id });
    expect(off.status).toBe("discarded");
    await expect(
      svc().edit({ ...M, draftId: d.id, baseVersion: 1, text: "x" }),
    ).rejects.toMatchObject({ reason: "draft_closed" });
    await expect(svc().discard({ ...M, draftId: d.id })).rejects.toMatchObject({
      reason: "draft_closed",
    });
    const e = await create();
    await t.db
      .update(drafts)
      .set({ status: "sent" })
      .where(eq(drafts.id, e.id));
    await expect(
      svc().edit({ ...M, draftId: e.id, baseVersion: 1, text: "x" }),
    ).rejects.toMatchObject({ reason: "draft_closed" });
  });

  it("kiểm nội dung: rỗng, chỉ khoảng trắng, quá dài bị từ chối; đúng trần được nhận [F-006/AC-04]", async () => {
    for (const text of ["", "   ", "x".repeat(MAX_DRAFT_CHARS + 1)])
      await expect(create(text)).rejects.toBeInstanceOf(ValidationError);
    await expect(create("x".repeat(MAX_DRAFT_CHARS))).resolves.toBeDefined();
    const d = await create();
    for (const baseVersion of [0, -1, 1.5, Number.NaN])
      await expect(
        svc().edit({ ...M, draftId: d.id, baseVersion, text: "x" }),
      ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      svc().edit({ ...M, draftId: d.id, baseVersion: 1, text: "   " }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("hội thoại workspace khác hoặc id lạ là NotFound; người ngoài bị Forbidden; không để lại dòng nào [F-006/AC-11]", async () => {
    await expect(create("x", { conversationId: convB })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(create("x", { conversationId: "lạ" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(create("x", { actorId: "outsider" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await t.db.select().from(drafts)).toHaveLength(0);
    const d = await create();
    await expect(
      svc().get({ actorId: "outsider", workspaceId: wsB, draftId: d.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      svc().edit({
        actorId: "outsider",
        workspaceId: wsB,
        draftId: d.id,
        baseVersion: 1,
        text: "x",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc().get({ ...M, draftId: "lạ" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("liệt kê nháp của hội thoại, mới sửa trước; xoá hội thoại xoá luôn nháp và phiên bản [F-006/AC-02]", async () => {
    const a = await create("a");
    const b = await create("b");
    await svc().edit({ ...M, draftId: a.id, baseVersion: 1, text: "a2" });
    expect(
      (await svc().listForConversation({ ...M, conversationId: conv })).map(
        (d) => d.id,
      ),
    ).toEqual([a.id, b.id]);
    await t.db.delete(conversations).where(eq(conversations.id, conv));
    expect(await t.db.select().from(drafts)).toHaveLength(0);
    expect(await t.db.select().from(draftVersions)).toHaveLength(0);
  });

  it("CHECK của CSDL từ chối phiên bản trùng, nguồn lạ và nội dung rỗng [F-006/AC-04]", async () => {
    const d = await create();
    const base = { workspaceId: ws, draftId: d.id, createdBy: "u" };
    for (const row of [
      { ...base, version: 1, text: "trùng", source: "human" as const },
      { ...base, version: 5, text: "x", source: "bot" as never },
      { ...base, version: 6, text: "   ", source: "human" as const },
    ])
      await expect(t.db.insert(draftVersions).values(row)).rejects.toThrow();
  });
});
