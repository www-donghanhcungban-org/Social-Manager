import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/src/auth/errors";
import {
  conversations,
  decisions,
  evidenceItems,
  members,
  messages,
  projects,
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
const A = { actorId: "admin" };
const at = (s: number) => new Date(Date.UTC(2026, 10, 22, 8, 0, s));

const doc = (ext: string, workspaceId = ws, observedAt = at(0)) =>
  evidence.ingestAsSystem({
    workspaceId,
    source: "document",
    externalId: ext,
    content: `biên bản ${ext}`,
    contentType: "text/markdown",
    observedAt,
  });
const project = (name = "P") =>
  svc.createProject({ ...A, workspaceId: ws, name });
const decide = (
  projectId: string,
  sourceEvidenceItemId: string,
  over: Record<string, unknown> = {},
) =>
  svc.recordDecision({
    ...A,
    workspaceId: ws,
    projectId,
    text: "Chốt giá 200k",
    sourceEvidenceItemId,
    ...over,
  });

beforeEach(async () => {
  t = await createTestDb();
  const [a] = await t.db.insert(workspaces).values({ name: "A" }).returning();
  const [b] = await t.db.insert(workspaces).values({ name: "B" }).returning();
  ws = a!.id;
  wsB = b!.id;
  await t.db.insert(members).values([
    { workspaceId: ws, userId: "admin", role: "admin" },
    { workspaceId: ws, userId: "member", role: "member" },
    { workspaceId: wsB, userId: "other", role: "owner" },
  ]);
  evidence = createEvidenceService({
    db: t.db,
    store: createMemoryBlobStore(),
  });
  svc = createKnowledgeService({ db: t.db, evidence });
});
afterEach(async () => {
  await t.client.close();
});

describe("sổ quyết định", () => {
  it("ghi quyết định kèm nguồn; thời điểm mặc định là lúc nguồn xảy ra", async () => {
    const p = await project();
    const src = await doc("họp-1", ws, at(30));
    const d = await decide(p.id, src.itemId);
    expect(d).toMatchObject({
      text: "Chốt giá 200k",
      status: "active",
      sourceItemId: src.itemId,
      sourceLabel: "họp-1",
      sourceMissing: false,
      supersededById: null,
    });
    expect(d.decidedAt).toEqual(at(30));
    const explicit = await decide(p.id, src.itemId, {
      decidedAt: at(99),
      text: "Khác",
    });
    expect(explicit.decidedAt).toEqual(at(99));
  });

  it("bắt buộc có nguồn cùng workspace; nguồn lạ hoặc của workspace khác là NotFound", async () => {
    const p = await project();
    const foreign = await doc("x", wsB);
    for (const id of [
      foreign.itemId,
      "lạ",
      "00000000-0000-4000-8000-000000000000",
    ])
      await expect(decide(p.id, id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await t.db.select().from(decisions)).toHaveLength(0);
  });

  it("thay thế: cái cũ thành superseded và trỏ tới cái mới; liệt kê mặc định chỉ hiệu lực", async () => {
    const p = await project();
    const src = await doc("a");
    const d1 = await decide(p.id, src.itemId, { text: "Giá 200k" });
    const d2 = await decide(p.id, src.itemId, {
      text: "Giá 250k",
      supersedesId: d1.id,
    });
    const active = await svc.listDecisions({
      ...A,
      workspaceId: ws,
      projectId: p.id,
    });
    expect(active.map((d) => d.id)).toEqual([d2.id]);
    const all = await svc.listDecisions({
      ...A,
      workspaceId: ws,
      projectId: p.id,
      includeSuperseded: true,
    });
    expect(all.find((d) => d.id === d1.id)).toMatchObject({
      status: "superseded",
      supersededById: d2.id,
    });
  });

  it("không thay được quyết định đã bị thay; không thay quyết định của dự án khác; thất bại không để lại dòng nào", async () => {
    const p = await project("P1");
    const q = await project("P2");
    const src = await doc("a");
    const d1 = await decide(p.id, src.itemId);
    await decide(p.id, src.itemId, { text: "mới", supersedesId: d1.id });
    await expect(
      decide(p.id, src.itemId, { text: "lần hai", supersedesId: d1.id }),
    ).rejects.toMatchObject({ reason: "decision_not_active" });
    const dq = await decide(q.id, src.itemId, { text: "của Q" });
    await expect(
      decide(p.id, src.itemId, { text: "nhầm", supersedesId: dq.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      decide(p.id, src.itemId, { supersedesId: "lạ" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // d1(cũ), mới, dq — không có dòng "lần hai"/"nhầm"
    expect(
      (await t.db.select().from(decisions)).map((d) => d.text).sort(),
    ).toEqual(["Chốt giá 200k", "mới", "của Q"].sort());
  });

  it("luôn còn đúng một quyết định hiệu lực trong chuỗi thay thế", async () => {
    const p = await project();
    const src = await doc("a");
    let prev = await decide(p.id, src.itemId, { text: "v0" });
    for (let i = 1; i <= 4; i++)
      prev = await decide(p.id, src.itemId, {
        text: `v${i}`,
        supersedesId: prev.id,
      });
    const rows = await t.db.select().from(decisions);
    expect(rows.filter((r) => r.status === "active")).toHaveLength(1);
    expect(rows.filter((r) => r.status === "superseded")).toHaveLength(4);
  });

  it("xoá bằng chứng nguồn giữ quyết định nhưng đánh dấu mất nguồn, còn nhãn nguồn", async () => {
    const p = await project();
    const src = await doc("biên-bản-họp");
    await decide(p.id, src.itemId);
    await t.db.delete(evidenceItems).where(eq(evidenceItems.id, src.itemId));
    const [d] = await svc.listDecisions({
      ...A,
      workspaceId: ws,
      projectId: p.id,
    });
    expect(d).toMatchObject({
      sourceItemId: null,
      sourceMissing: true,
      sourceLabel: "biên-bản-họp",
      text: "Chốt giá 200k",
    });
  });

  it("kiểm đầu vào: nội dung rỗng/quá dài, ngày hỏng; quyền: member chỉ đọc, người ngoài bị Forbidden", async () => {
    const p = await project();
    const src = await doc("a");
    for (const text of ["", "   ", "x".repeat(2001)])
      await expect(decide(p.id, src.itemId, { text })).rejects.toBeInstanceOf(
        ValidationError,
      );
    await expect(
      decide(p.id, src.itemId, { text: "x".repeat(2000) }),
    ).resolves.toBeDefined();
    await expect(
      decide(p.id, src.itemId, { decidedAt: new Date("hỏng") }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      svc.recordDecision({
        actorId: "member",
        workspaceId: ws,
        projectId: p.id,
        text: "x",
        sourceEvidenceItemId: src.itemId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      svc.listDecisions({
        actorId: "member",
        workspaceId: ws,
        projectId: p.id,
      }),
    ).resolves.toHaveLength(1);
    await expect(
      svc.listDecisions({ actorId: "other", workspaceId: ws, projectId: p.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      svc.listDecisions({
        actorId: "other",
        workspaceId: wsB,
        projectId: p.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("xoá dự án xoá luôn quyết định; ConflictError đúng loại", async () => {
    const p = await project();
    const src = await doc("a");
    const d = await decide(p.id, src.itemId);
    await decide(p.id, src.itemId, { supersedesId: d.id });
    await expect(
      decide(p.id, src.itemId, { supersedesId: d.id }),
    ).rejects.toBeInstanceOf(ConflictError);
    await t.db.delete(projects);
    expect(await t.db.select().from(decisions)).toHaveLength(0);
  });
});

describe("hồ sơ dự án", () => {
  it("dự án rỗng: không nguồn, không hoạt động, không quyết định", async () => {
    const p = await project("Dự án Hoa");
    expect(
      await svc.profile({ ...A, workspaceId: ws, projectId: p.id }),
    ).toEqual({
      id: p.id,
      name: "Dự án Hoa",
      aliases: [],
      linked: { conversations: 0, evidence: 0 },
      evidenceCount: 0,
      lastActivityAt: null,
      activeDecisions: [],
    });
  });

  it("tổng hợp bí danh, số nguồn (kể cả qua hội thoại), hoạt động gần nhất và quyết định đang hiệu lực kèm nguồn", async () => {
    const p = await project("Dự án Hoa");
    await svc.addAlias({
      ...A,
      workspaceId: ws,
      projectId: p.id,
      alias: "Hoa Hồng",
    });
    const d1 = await doc("biên-bản", ws, at(10));
    await svc.link({
      ...A,
      workspaceId: ws,
      projectId: p.id,
      target: { type: "evidence", evidenceItemId: d1.itemId },
    });
    const [c] = await t.db
      .insert(providerConnections)
      .values({
        workspaceId: ws,
        provider: "demo",
        label: "c",
        credentialsEnc: "v1:x",
      })
      .returning();
    const [acc] = await t.db
      .insert(socialAccounts)
      .values({
        connectionId: c!.id,
        platform: "facebook",
        externalId: "p",
        displayName: "P",
      })
      .returning();
    const [conv] = await t.db
      .insert(conversations)
      .values({
        workspaceId: ws,
        socialAccountId: acc!.id,
        externalId: "c1",
        participantId: "u",
        participantName: "Lan",
      })
      .returning();
    for (const [i, s] of [20, 40].entries())
      await t.db.insert(messages).values({
        workspaceId: ws,
        conversationId: conv!.id,
        socialAccountId: acc!.id,
        externalId: `m${i}`,
        direction: "incoming",
        author: "Lan",
        text: `tin ${i}`,
        sentAt: at(s),
      });
    await evidence.backfillMessages({ workspaceId: ws });
    await svc.link({
      ...A,
      workspaceId: ws,
      projectId: p.id,
      target: { type: "conversation", conversationId: conv!.id },
    });
    const old = await decide(p.id, d1.itemId, { text: "Giá cũ" });
    await decide(p.id, d1.itemId, { text: "Giá mới", supersedesId: old.id });
    const profile = await svc.profile({
      actorId: "member",
      workspaceId: ws,
      projectId: p.id,
    });
    expect(profile).toMatchObject({
      name: "Dự án Hoa",
      aliases: ["Hoa Hồng"],
      linked: { conversations: 1, evidence: 1 },
      evidenceCount: 3,
    });
    expect(profile.lastActivityAt).toEqual(at(40));
    expect(profile.activeDecisions.map((d) => d.text)).toEqual(["Giá mới"]);
    expect(profile.activeDecisions[0]).toMatchObject({
      sourceItemId: d1.itemId,
      sourceMissing: false,
    });
  });

  it("người ngoài bị Forbidden; dự án workspace khác là NotFound", async () => {
    const p = await project();
    await expect(
      svc.profile({ actorId: "other", workspaceId: ws, projectId: p.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      svc.profile({ actorId: "other", workspaceId: wsB, projectId: p.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
