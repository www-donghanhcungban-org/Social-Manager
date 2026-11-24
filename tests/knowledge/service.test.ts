import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/src/auth/errors";
import {
  conversations,
  evidenceItems,
  members,
  projectLinks,
  projects,
  providerConnections,
  socialAccounts,
  workspaces,
} from "@/src/db/schema";
import { createMemoryBlobStore } from "@/src/evidence/blob-store";
import { createEvidenceService } from "@/src/evidence/service";
import {
  createKnowledgeService,
  MAX_ALIASES_PER_PROJECT,
  MAX_PROJECTS_PER_WORKSPACE,
} from "@/src/knowledge/service";
import { ValidationError } from "@/src/providers/types";

import { createTestDb } from "../db/helpers";

let t: Awaited<ReturnType<typeof createTestDb>>;
let wsA: string;
let wsB: string;
let convA: string;
let convB: string;
let evA: string;
const svc = () => createKnowledgeService({ db: t.db });
const as = (actorId: string, workspaceId = wsA) => ({ actorId, workspaceId });
const mk = (name: string, actorId = "admin") =>
  svc().createProject({ ...as(actorId), name });

async function seedConversation(workspaceId: string, ext: string) {
  const [c] = await t.db
    .insert(providerConnections)
    .values({
      workspaceId,
      provider: "demo",
      label: `c-${ext}`,
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

beforeEach(async () => {
  t = await createTestDb();
  const [a] = await t.db.insert(workspaces).values({ name: "A" }).returning();
  const [b] = await t.db.insert(workspaces).values({ name: "B" }).returning();
  wsA = a!.id;
  wsB = b!.id;
  await t.db.insert(members).values([
    { workspaceId: wsA, userId: "owner", role: "owner" },
    { workspaceId: wsA, userId: "admin", role: "admin" },
    { workspaceId: wsA, userId: "member", role: "member" },
    { workspaceId: wsB, userId: "other", role: "owner" },
  ]);
  convA = await seedConversation(wsA, "pa");
  convB = await seedConversation(wsB, "pb");
  const ev = await createEvidenceService({
    db: t.db,
    store: createMemoryBlobStore(),
  }).ingestAsSystem({
    workspaceId: wsA,
    source: "document",
    externalId: "d1",
    content: "Biên bản họp",
    contentType: "text/markdown",
    observedAt: new Date("2026-11-22T08:00:00Z"),
  });
  evA = ev.itemId;
});
afterEach(async () => {
  await t.client.close();
});

describe("dự án", () => {
  it("admin tạo, member chỉ đọc, người ngoài không thấy [F-007/AC-09]", async () => {
    const p = await mk("Cửa hàng Hoa");
    expect(p.name).toBe("Cửa hàng Hoa");
    await expect(mk("X", "member")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(mk("X", "other")).rejects.toBeInstanceOf(ForbiddenError);
    expect((await svc().list(as("member"))).map((x) => x.name)).toEqual([
      "Cửa hàng Hoa",
    ]);
    await expect(svc().list(as("other"))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await svc().list(as("other", wsB))).toEqual([]);
  });

  it("chuẩn hoá NFC và khoảng trắng; trùng tên không phân biệt hoa thường/NFD bị từ chối [F-007/AC-04]", async () => {
    await mk("  Việt   Nam ".normalize("NFD"));
    expect((await svc().list(as("member")))[0]!.name).toBe("Việt Nam");
    for (const dup of ["việt nam", "VIỆT NAM", "Việt Nam".normalize("NFD")])
      await expect(mk(dup)).rejects.toMatchObject({ reason: "name_taken" });
    // workspace khác dùng được cùng tên
    await expect(
      svc().createProject({ ...as("other", wsB), name: "Việt Nam" }),
    ).resolves.toBeDefined();
  });

  it("từ chối tên rỗng, chỉ khoảng trắng, quá 100 ký tự; nhận đúng 100 [F-007/AC-04]", async () => {
    for (const name of ["", "   ", "x".repeat(101)])
      await expect(mk(name)).rejects.toBeInstanceOf(ValidationError);
    await expect(mk("x".repeat(100))).resolves.toBeDefined();
  });

  it("trần số dự án mỗi workspace [F-007/AC-04]", async () => {
    await t.db.insert(projects).values(
      Array.from({ length: MAX_PROJECTS_PER_WORKSPACE }, (_, i) => ({
        workspaceId: wsA,
        name: `P${i}`,
        nameKey: `p${i}`,
      })),
    );
    await expect(mk("thêm")).rejects.toMatchObject({
      reason: "project_limit",
    });
  });
});

describe("bí danh", () => {
  it("thêm, liệt kê cùng dự án, so khớp không phân biệt hoa thường; trùng trong workspace bị từ chối [F-007/AC-04]", async () => {
    const a = await mk("Dự án A");
    const b = await mk("Dự án B");
    await svc().addAlias({
      ...as("admin"),
      projectId: a.id,
      alias: "Hoa Hồng",
    });
    await expect(
      svc().addAlias({ ...as("admin"), projectId: b.id, alias: "hoa hồng" }),
    ).rejects.toMatchObject({ reason: "alias_taken" });
    const listed = await svc().list(as("member"));
    expect(
      listed.find((p) => p.id === a.id)!.aliases.map((x) => x.alias),
    ).toEqual(["Hoa Hồng"]);
    expect(listed.find((p) => p.id === b.id)!.aliases).toEqual([]);
  });

  it("bí danh không được trùng tên dự án; tên dự án không được trùng bí danh [F-007/AC-04]", async () => {
    const a = await mk("Dự án A");
    await mk("Dự án B");
    await expect(
      svc().addAlias({ ...as("admin"), projectId: a.id, alias: "dự án b" }),
    ).rejects.toMatchObject({ reason: "alias_taken" });
    await svc().addAlias({ ...as("admin"), projectId: a.id, alias: "DA" });
    await expect(mk("da")).rejects.toMatchObject({ reason: "name_taken" });
  });

  it("trần bí danh mỗi dự án; gỡ bí danh; dự án/bí danh của workspace khác là NotFound [F-007/AC-04] [F-007/AC-09]", async () => {
    const a = await mk("Dự án A");
    for (let i = 0; i < MAX_ALIASES_PER_PROJECT; i++)
      await svc().addAlias({
        ...as("admin"),
        projectId: a.id,
        alias: `bd${i}`,
      });
    await expect(
      svc().addAlias({ ...as("admin"), projectId: a.id, alias: "thêm" }),
    ).rejects.toMatchObject({ reason: "alias_limit" });
    const first = (await svc().list(as("member")))[0]!.aliases[0]!;
    await expect(
      svc().removeAlias({ ...as("other", wsB), aliasId: first.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await svc().removeAlias({ ...as("admin"), aliasId: first.id });
    await expect(
      svc().addAlias({ ...as("other", wsB), projectId: a.id, alias: "x" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      svc().addAlias({ ...as("admin"), projectId: "lạ", alias: "x" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      svc().addAlias({ ...as("member"), projectId: a.id, alias: "x" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("liên kết nguồn–dự án", () => {
  it("gắn hội thoại và bằng chứng; gắn lại là lũy đẳng; liệt kê đủ [F-007/AC-05]", async () => {
    const p = await mk("Dự án A");
    const c1 = await svc().link({
      ...as("admin"),
      projectId: p.id,
      target: { type: "conversation", conversationId: convA },
    });
    const c2 = await svc().link({
      ...as("admin"),
      projectId: p.id,
      target: { type: "conversation", conversationId: convA },
    });
    expect(c1.created).toBe(true);
    expect(c2).toEqual({ id: c1.id, created: false });
    await svc().link({
      ...as("admin"),
      projectId: p.id,
      target: { type: "evidence", evidenceItemId: evA },
    });
    const links = await svc().listLinks({ ...as("member"), projectId: p.id });
    expect(links.map((l) => l.targetType).sort()).toEqual([
      "conversation",
      "evidence",
    ]);
    expect(links.find((l) => l.targetType === "conversation")).toMatchObject({
      conversationId: convA,
      evidenceItemId: null,
      createdBy: "admin",
    });
  });

  it("một nguồn gắn được nhiều dự án [F-007/AC-05]", async () => {
    const a = await mk("A");
    const b = await mk("B");
    for (const p of [a, b])
      await svc().link({
        ...as("admin"),
        projectId: p.id,
        target: { type: "conversation", conversationId: convA },
      });
    expect(await t.db.select().from(projectLinks)).toHaveLength(2);
  });

  it("nguồn của workspace khác hoặc id lạ là NotFound; member không gắn được [F-007/AC-09]", async () => {
    const p = await mk("A");
    for (const target of [
      { type: "conversation", conversationId: convB } as const,
      { type: "conversation", conversationId: "lạ" } as const,
      {
        type: "evidence",
        evidenceItemId: "00000000-0000-4000-8000-000000000000",
      } as const,
    ])
      await expect(
        svc().link({ ...as("admin"), projectId: p.id, target }),
      ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      svc().link({
        ...as("member"),
        projectId: p.id,
        target: { type: "conversation", conversationId: convA },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("gỡ liên kết không xoá hội thoại hay bằng chứng [F-007/AC-05]", async () => {
    const p = await mk("A");
    const l = await svc().link({
      ...as("admin"),
      projectId: p.id,
      target: { type: "evidence", evidenceItemId: evA },
    });
    await svc().unlink({ ...as("admin"), linkId: l.id });
    expect(await t.db.select().from(projectLinks)).toHaveLength(0);
    expect(await t.db.select().from(evidenceItems)).toHaveLength(1);
    await expect(
      svc().unlink({ ...as("admin"), linkId: l.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      svc().unlink({ ...as("member"), linkId: l.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("xoá nguồn xoá liên kết theo tầng; xoá dự án xoá liên kết và bí danh nhưng giữ nguồn [F-007/AC-05]", async () => {
    const p = await mk("A");
    await svc().addAlias({ ...as("admin"), projectId: p.id, alias: "bd" });
    await svc().link({
      ...as("admin"),
      projectId: p.id,
      target: { type: "conversation", conversationId: convA },
    });
    await svc().link({
      ...as("admin"),
      projectId: p.id,
      target: { type: "evidence", evidenceItemId: evA },
    });
    await t.db.delete(conversations).where(eq(conversations.id, convA));
    expect(await t.db.select().from(projectLinks)).toHaveLength(1);
    await t.db.delete(projects).where(eq(projects.id, p.id));
    expect(await t.db.select().from(projectLinks)).toHaveLength(0);
    expect(await t.db.select().from(evidenceItems)).toHaveLength(1);
  });

  it("CHECK của CSDL từ chối liên kết thiếu đích hoặc có hai đích [F-007/AC-05]", async () => {
    const p = await mk("A");
    const base = { workspaceId: wsA, projectId: p.id, createdBy: "admin" };
    for (const row of [
      { ...base, targetType: "conversation" as const },
      {
        ...base,
        targetType: "conversation" as const,
        conversationId: convA,
        evidenceItemId: evA,
      },
      { ...base, targetType: "evidence" as const, conversationId: convA },
    ])
      await expect(t.db.insert(projectLinks).values(row)).rejects.toMatchObject(
        {
          cause: { code: "23514" },
        },
      );
  });

  it("dùng ConflictError đúng loại", async () => {
    await mk("A");
    await expect(mk("a")).rejects.toBeInstanceOf(ConflictError);
  });
});
