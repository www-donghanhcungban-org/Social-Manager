import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError, NotFoundError } from "@/src/auth/errors";
import {
  conversations,
  members,
  messages,
  providerConnections,
  socialAccounts,
  workspaces,
} from "@/src/db/schema";
import { createMemoryBlobStore } from "@/src/evidence/blob-store";
import { createEvidenceService } from "@/src/evidence/service";
import { createKnowledgeService } from "@/src/knowledge/service";
import { ValidationError } from "@/src/providers/types";

import { createTestDb } from "../db/helpers";

let t: Awaited<ReturnType<typeof createTestDb>>;
let ws: string;
let wsB: string;
let evidence: ReturnType<typeof createEvidenceService>;
let svc: ReturnType<typeof createKnowledgeService>;
let acc: string;
const A = { actorId: "admin" };
const at = (s: number) => new Date(Date.UTC(2026, 10, 22, 8, 0, s));

const doc = (ext: string, observedAt = at(0)) =>
  evidence.ingestAsSystem({
    workspaceId: ws,
    source: "document",
    externalId: ext,
    content: `nội dung ${ext}`,
    contentType: "text/markdown",
    observedAt,
  });
const timeline = (projectId: string, over = {}) =>
  svc.timeline({ ...A, workspaceId: ws, projectId, ...over });
const project = (name = "P") =>
  svc.createProject({ ...A, workspaceId: ws, name });
const linkDoc = (projectId: string, evidenceItemId: string) =>
  svc.link({
    ...A,
    workspaceId: ws,
    projectId,
    target: { type: "evidence", evidenceItemId },
  });

async function conversationWithMessages(ext: string, times: number[]) {
  const [conv] = await t.db
    .insert(conversations)
    .values({
      workspaceId: ws,
      socialAccountId: acc,
      externalId: ext,
      participantId: "u",
      participantName: "Lan",
    })
    .returning();
  for (const [i, s] of times.entries())
    await t.db.insert(messages).values({
      workspaceId: ws,
      conversationId: conv!.id,
      socialAccountId: acc,
      externalId: `${ext}-m${i}`,
      direction: "incoming",
      author: "Lan",
      text: `tin ${ext} ${i}`,
      sentAt: at(s),
    });
  await evidence.backfillMessages({ workspaceId: ws });
  return conv!.id;
}

beforeEach(async () => {
  t = await createTestDb();
  const [w] = await t.db.insert(workspaces).values({ name: "A" }).returning();
  const [b] = await t.db.insert(workspaces).values({ name: "B" }).returning();
  ws = w!.id;
  wsB = b!.id;
  await t.db.insert(members).values([
    { workspaceId: ws, userId: "admin", role: "admin" },
    { workspaceId: ws, userId: "member", role: "member" },
    { workspaceId: wsB, userId: "other", role: "owner" },
  ]);
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
  evidence = createEvidenceService({
    db: t.db,
    store: createMemoryBlobStore(),
  });
  svc = createKnowledgeService({ db: t.db, evidence });
});
afterEach(async () => {
  await t.client.close();
});

describe("dòng thời gian dự án", () => {
  it("dự án rỗng trả danh sách rỗng [F-007/AC-06]", async () => {
    const p = await project();
    expect(await timeline(p.id)).toEqual({ items: [], nextCursor: null });
  });

  it("gộp bằng chứng gắn trực tiếp và tin của hội thoại đã gắn, mới nhất trước [F-007/AC-06]", async () => {
    const p = await project();
    const d = await doc("biên-bản", at(5));
    await linkDoc(p.id, d.itemId);
    const conv = await conversationWithMessages("c1", [1, 9]);
    await svc.link({
      ...A,
      workspaceId: ws,
      projectId: p.id,
      target: { type: "conversation", conversationId: conv },
    });
    await doc("không-liên-quan", at(7));
    const r = await timeline(p.id);
    expect(
      r.items.map((i) => [i.source, i.observedAt.getUTCSeconds()]),
    ).toEqual([
      ["message", 9],
      ["document", 5],
      ["message", 1],
    ]);
  });

  it("mục gắn cả trực tiếp lẫn qua hội thoại chỉ xuất hiện một lần [F-007/AC-06]", async () => {
    const p = await project();
    const conv = await conversationWithMessages("c1", [1]);
    await svc.link({
      ...A,
      workspaceId: ws,
      projectId: p.id,
      target: { type: "conversation", conversationId: conv },
    });
    const [item] = (await timeline(p.id)).items;
    await linkDoc(p.id, item!.id);
    expect((await timeline(p.id)).items).toHaveLength(1);
  });

  it("chỉ thấy mục của dự án đang xem, không lẫn dự án khác", async () => {
    const a = await project("A");
    const b = await project("B");
    await linkDoc(a.id, (await doc("x")).itemId);
    await linkDoc(b.id, (await doc("y")).itemId);
    expect((await timeline(a.id)).items.map((i) => i.externalId)).toEqual([
      "x",
    ]);
  });

  it("phân trang cursor không sót, không lặp kể cả trùng thời điểm [F-007/AC-06]", async () => {
    const p = await project();
    for (let i = 0; i < 7; i++)
      await linkDoc(p.id, (await doc(`d${i}`, at(Math.min(i, 4)))).itemId);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await timeline(p.id, { limit: 3, cursor });
      expect(page.items.length).toBeLessThanOrEqual(3);
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it("gỡ liên kết thì mục rời khỏi dòng thời gian nhưng bằng chứng còn", async () => {
    const p = await project();
    const d = await doc("x");
    const l = await linkDoc(p.id, d.itemId);
    await svc.unlink({ ...A, workspaceId: ws, linkId: l.id });
    expect((await timeline(p.id)).items).toEqual([]);
    expect(
      (await evidence.get({ ...A, workspaceId: ws, itemId: d.itemId }))
        .externalId,
    ).toBe("x");
  });

  it("member đọc được; người ngoài bị Forbidden; dự án workspace khác/lạ là NotFound; cursor hỏng là ValidationError [F-007/AC-09]", async () => {
    const p = await project();
    await expect(timeline(p.id, { actorId: "member" })).resolves.toBeDefined();
    await expect(timeline(p.id, { actorId: "other" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      svc.timeline({ actorId: "other", workspaceId: wsB, projectId: p.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(timeline("lạ")).rejects.toBeInstanceOf(NotFoundError);
    await expect(timeline(p.id, { cursor: "!!!" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
