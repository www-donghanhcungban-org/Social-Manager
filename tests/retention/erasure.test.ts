import { eq } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError, NotFoundError } from "@/src/auth/errors";
import {
  conversations,
  evidenceBlobs,
  evidenceItems,
  inboxItems,
  members,
  messages,
  projectLinks,
  projects,
  providerConnections,
  socialAccounts,
  workspaces,
} from "@/src/db/schema";
import { createMemoryBlobStore } from "@/src/evidence/blob-store";
import { createEvidenceService } from "@/src/evidence/service";
import { createKnowledgeService } from "@/src/knowledge/service";
import { ValidationError } from "@/src/providers/types";
import { createErasureService } from "@/src/retention/erasure";

import { createTestDb } from "../db/helpers";

const T0 = Date.UTC(2026, 10, 22, 8, 0, 0);
const at = (s: number) => new Date(T0 + s * 1000);
const NOW = new Date("2026-11-23T00:00:00Z");

let t: Awaited<ReturnType<typeof createTestDb>>;
let store: ReturnType<typeof createMemoryBlobStore>;
let ws: string;
let wsB: string;
let acc: string;
let evidence: ReturnType<typeof createEvidenceService>;
let knowledge: ReturnType<typeof createKnowledgeService>;
const owner = { actorId: "owner", workspaceId: "" };
const erasure = () =>
  createErasureService({ db: t.db, evidence, now: () => NOW });

async function conversation(ext: string, texts: string[]) {
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
  for (const [i, text] of texts.entries())
    await t.db.insert(messages).values({
      workspaceId: ws,
      conversationId: conv!.id,
      socialAccountId: acc,
      externalId: `${ext}-${i}`,
      direction: "incoming",
      author: "Lan",
      text,
      sentAt: at(i),
    });
  await t.db.insert(inboxItems).values({
    workspaceId: ws,
    socialAccountId: acc,
    kind: "dm",
    externalId: ext,
    author: "Lan",
    text: texts[0]!,
    receivedAt: at(0),
  });
  await evidence.backfillMessages({ workspaceId: ws });
  return conv!.id;
}
const doc = (ext: string, content: string) =>
  evidence.ingestAsSystem({
    workspaceId: ws,
    source: "document",
    externalId: ext,
    content,
    contentType: "text/markdown",
    observedAt: at(0),
  });
const count = async (table: PgTable) =>
  (await t.db.select().from(table)).length;

beforeEach(async () => {
  t = await createTestDb();
  store = createMemoryBlobStore();
  const [w] = await t.db.insert(workspaces).values({ name: "A" }).returning();
  const [b] = await t.db.insert(workspaces).values({ name: "B" }).returning();
  ws = w!.id;
  wsB = b!.id;
  owner.workspaceId = ws;
  await t.db.insert(members).values([
    { workspaceId: ws, userId: "owner", role: "owner" },
    { workspaceId: ws, userId: "admin", role: "admin" },
    { workspaceId: ws, userId: "member", role: "member" },
    { workspaceId: wsB, userId: "ownerB", role: "owner" },
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
  evidence = createEvidenceService({ db: t.db, store });
  knowledge = createKnowledgeService({ db: t.db, evidence });
});
afterEach(async () => {
  await t.client.close();
});

describe("xoá hội thoại xuyên lớp", () => {
  it("xoá hội thoại, tin, bằng chứng của tin, mục hộp thư, liên kết và blob; hội thoại khác nguyên vẹn", async () => {
    const c1 = await conversation("c1", ["bí mật của Lan", "tin hai"]);
    await conversation("c2", ["tin khác"]);
    const p = await knowledge.createProject({ ...owner, name: "P" });
    await knowledge.link({
      ...owner,
      projectId: p.id,
      target: { type: "conversation", conversationId: c1 },
    });
    expect(store.size).toBe(3);
    const r = await erasure().eraseConversation({
      ...owner,
      conversationId: c1,
    });
    expect(r).toEqual({
      conversations: 1,
      messages: 2,
      inboxItems: 1,
      evidenceItems: 2,
      projects: 0,
      blobs: 2,
    });
    expect(await count(conversations)).toBe(1);
    expect(await count(messages)).toBe(1);
    expect(await count(inboxItems)).toBe(1);
    expect(await count(evidenceItems)).toBe(1);
    expect(await count(evidenceBlobs)).toBe(1);
    expect(await count(projectLinks)).toBe(0);
    expect(await count(projects)).toBe(1); // dự án giữ nguyên
    expect(store.size).toBe(1);
  });

  it("chỉ owner xoá được; admin/member bị Forbidden; hội thoại workspace khác hoặc đã xoá là NotFound", async () => {
    const c1 = await conversation("c1", ["x"]);
    for (const actorId of ["admin", "member", "ownerB"])
      await expect(
        erasure().eraseConversation({
          actorId,
          workspaceId: ws,
          conversationId: c1,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      erasure().eraseConversation({
        actorId: "ownerB",
        workspaceId: wsB,
        conversationId: c1,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await erasure().eraseConversation({ ...owner, conversationId: c1 });
    await expect(
      erasure().eraseConversation({ ...owner, conversationId: c1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      erasure().eraseConversation({ ...owner, conversationId: "lạ" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("vượt trần số dòng thì không xoá gì (một giao dịch)", async () => {
    const c1 = await conversation("c1", ["a", "b", "c"]);
    await expect(
      erasure().eraseConversation({ ...owner, conversationId: c1, maxRows: 3 }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await count(conversations)).toBe(1);
    expect(await count(messages)).toBe(3);
    expect(await count(inboxItems)).toBe(1);
    expect(await count(evidenceItems)).toBe(3);
    // đủ trần thì xoá được: 1 hội thoại + 3 tin + 3 bằng chứng + 1 mục hộp thư = 8
    await expect(
      erasure().eraseConversation({ ...owner, conversationId: c1, maxRows: 8 }),
    ).resolves.toMatchObject({ messages: 3 });
    await expect(
      erasure().eraseConversation({ ...owner, conversationId: c1, maxRows: 0 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("blob còn được nơi khác dùng thì giữ lại nội dung", async () => {
    const c1 = await conversation("c1", ["Cảm ơn shop"]);
    await doc("d", "Cảm ơn shop");
    const r = await erasure().eraseConversation({
      ...owner,
      conversationId: c1,
    });
    expect(r.blobs).toBe(0);
    expect(store.size).toBe(1);
  });
});

describe("xoá bằng chứng đơn lẻ", () => {
  it("xoá tài liệu, liên kết theo tầng và dọn blob; bằng chứng của tin phải xoá qua hội thoại", async () => {
    const d = await doc("d", "tài liệu mật");
    const p = await knowledge.createProject({ ...owner, name: "P" });
    await knowledge.link({
      ...owner,
      projectId: p.id,
      target: { type: "evidence", evidenceItemId: d.itemId },
    });
    await conversation("c1", ["tin"]);
    const [msgEv] = await t.db
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.source, "message"));
    await expect(
      erasure().eraseEvidenceItem({ ...owner, itemId: msgEv!.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    const r = await erasure().eraseEvidenceItem({ ...owner, itemId: d.itemId });
    expect(r).toMatchObject({ evidenceItems: 1, blobs: 1 });
    expect(await count(projectLinks)).toBe(0);
    await expect(
      erasure().eraseEvidenceItem({ ...owner, itemId: d.itemId }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      erasure().eraseEvidenceItem({
        actorId: "admin",
        workspaceId: ws,
        itemId: d.itemId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("xoá dự án", () => {
  it("mặc định chỉ xoá dự án, bí danh, liên kết; nguồn giữ nguyên", async () => {
    const c1 = await conversation("c1", ["tin"]);
    const d = await doc("d", "tài liệu");
    const p = await knowledge.createProject({ ...owner, name: "P" });
    await knowledge.addAlias({ ...owner, projectId: p.id, alias: "bd" });
    await knowledge.link({
      ...owner,
      projectId: p.id,
      target: { type: "conversation", conversationId: c1 },
    });
    await knowledge.link({
      ...owner,
      projectId: p.id,
      target: { type: "evidence", evidenceItemId: d.itemId },
    });
    const r = await erasure().eraseProject({ ...owner, projectId: p.id });
    expect(r).toMatchObject({
      projects: 1,
      conversations: 0,
      evidenceItems: 0,
    });
    expect(await count(projects)).toBe(0);
    expect(await count(projectLinks)).toBe(0);
    expect(await count(conversations)).toBe(1);
    expect(await count(evidenceItems)).toBe(2);
  });

  it("includeSources xoá luôn hội thoại và tài liệu đã gắn, không đụng nguồn chưa gắn", async () => {
    const c1 = await conversation("c1", ["tin một"]);
    await conversation("c2", ["tin chưa gắn"]);
    const d = await doc("d", "tài liệu");
    await doc("khác", "tài liệu không gắn");
    const p = await knowledge.createProject({ ...owner, name: "P" });
    await knowledge.link({
      ...owner,
      projectId: p.id,
      target: { type: "conversation", conversationId: c1 },
    });
    await knowledge.link({
      ...owner,
      projectId: p.id,
      target: { type: "evidence", evidenceItemId: d.itemId },
    });
    const r = await erasure().eraseProject({
      ...owner,
      projectId: p.id,
      includeSources: true,
    });
    expect(r).toMatchObject({ projects: 1, conversations: 1, messages: 1 });
    expect(await count(conversations)).toBe(1);
    const left = (await t.db.select().from(evidenceItems)).map(
      (e) => e.externalId,
    );
    expect(left.sort()).toEqual(
      [expect.stringMatching(/c2-0$/), "khác"].sort(),
    );
  });

  it("vượt trần thì giữ nguyên toàn bộ; dự án workspace khác là NotFound", async () => {
    const c1 = await conversation("c1", ["a", "b"]);
    const p = await knowledge.createProject({ ...owner, name: "P" });
    await knowledge.link({
      ...owner,
      projectId: p.id,
      target: { type: "conversation", conversationId: c1 },
    });
    await expect(
      erasure().eraseProject({
        ...owner,
        projectId: p.id,
        includeSources: true,
        maxRows: 2,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await count(projects)).toBe(1);
    expect(await count(conversations)).toBe(1);
    await expect(
      erasure().eraseProject({
        actorId: "ownerB",
        workspaceId: wsB,
        projectId: p.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("xuất dự án", () => {
  async function setup() {
    const c1 = await conversation("c1", ["Còn hàng không?", "Dạ còn ạ"]);
    const d = await doc("biên-bản", "# Biên bản\nChốt giá");
    const p = await knowledge.createProject({ ...owner, name: "Dự án Hoa" });
    await knowledge.addAlias({ ...owner, projectId: p.id, alias: "Hoa" });
    await knowledge.link({
      ...owner,
      projectId: p.id,
      target: { type: "conversation", conversationId: c1 },
    });
    await knowledge.link({
      ...owner,
      projectId: p.id,
      target: { type: "evidence", evidenceItemId: d.itemId },
    });
    return p;
  }

  it("xuất tên, bí danh, liên kết và nội dung nguyên văn; không kèm khoá hay mã nội bộ [F-009/AC-08]", async () => {
    const p = await setup();
    const out = await erasure().exportProject({
      actorId: "admin",
      workspaceId: ws,
      projectId: p.id,
    });
    expect(out.exportedAt).toBe(NOW.toISOString());
    expect(out.project).toEqual({ name: "Dự án Hoa", aliases: ["Hoa"] });
    expect(out.links.map((l) => l.targetType).sort()).toEqual([
      "conversation",
      "evidence",
    ]);
    expect(out.items.map((i) => i.content).sort()).toEqual(
      ["# Biên bản\nChốt giá", "Còn hàng không?", "Dạ còn ạ"].sort(),
    );
    for (const i of out.items) expect(i.sha256).toMatch(/^[0-9a-f]{64}$/);
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/credentials|webhook_secret|created_by|"owner"/i);
  });

  it("member không xuất được; workspace khác là NotFound; vượt trần xuất bị từ chối [F-009/AC-08]", async () => {
    const p = await setup();
    await expect(
      erasure().exportProject({
        actorId: "member",
        workspaceId: ws,
        projectId: p.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      erasure().exportProject({
        actorId: "ownerB",
        workspaceId: wsB,
        projectId: p.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      erasure().exportProject({ ...owner, projectId: p.id, maxItems: 2 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      erasure().exportProject({ ...owner, projectId: p.id, maxItems: 3 }),
    ).resolves.toBeDefined();
  });

  it("dự án rỗng xuất được; nội dung bị sửa trong kho thì không xuất (IntegrityError) [F-009/AC-08]", async () => {
    const empty = await knowledge.createProject({ ...owner, name: "Rỗng" });
    expect(
      (await erasure().exportProject({ ...owner, projectId: empty.id })).items,
    ).toEqual([]);
    const p = await setup();
    const [blob] = await t.db.select().from(evidenceBlobs);
    store.corrupt(blob!.sha256, new TextEncoder().encode("bị sửa"));
    await expect(
      erasure().exportProject({ ...owner, projectId: p.id }),
    ).rejects.toMatchObject({ code: "integrity" });
  });
});
