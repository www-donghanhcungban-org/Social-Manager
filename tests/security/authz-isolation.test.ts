import { randomBytes } from "node:crypto";

import { and, count, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAccountService } from "@/src/accounts/service";
import { createAiGateway } from "@/src/ai/gateway";
import { createAnswerService } from "@/src/ai/answer";
import type { ModelPort } from "@/src/ai/port";
import { ForbiddenError, NotFoundError } from "@/src/auth/errors";
import { ACTIONS, can } from "@/src/auth/permissions";
import { createConnectionService } from "@/src/connections/service";
import { createDraftService } from "@/src/actions/drafts";
import {
  conversations,
  drafts,
  members,
  projects,
  providerConnections,
  socialAccounts,
  workspaces,
  type Role,
} from "@/src/db/schema";
import { createMemoryBlobStore } from "@/src/evidence/blob-store";
import { createEvidenceService } from "@/src/evidence/service";
import { createKnowledgeService } from "@/src/knowledge/service";
import { createRegistry } from "@/src/providers/registry";
import type { SocialProvider } from "@/src/providers/types";
import { createSearchService } from "@/src/search/service";
import { createSecretBox } from "@/src/security/secret-box";
import { createWorkspaceService } from "@/src/workspaces/service";

import { createTestDb } from "../db/helpers";

/**
 * OWASP API Security Top 10 2023: API1 (BOLA — truy cập đối tượng không thuộc mình) và API5 (BFLA — gọi chức năng vượt
 * vai trò) ở TẦNG DỊCH VỤ: mọi đường vào (Server Action, route, job) đi qua đúng các hàm này, nên cô lập ở đây là cô lập
 * cho cả hệ thống (ADR-0007). Cô lập tầng ứng dụng, không RLS: xem D-025.
 */

let t: Awaited<ReturnType<typeof createTestDb>>;
let wsA: string;
let wsB: string;
let B: Seeded;
let A: Seeded;

const box = createSecretBox(randomBytes(32).toString("base64"));
const provider: SocialProvider = {
  id: "limited",
  label: "Hạn chế",
  support: { facebook: ["dm"] },
};
const registry = createRegistry();
registry.register(provider);

const store = createMemoryBlobStore();
const evidence = () => createEvidenceService({ db: t.db, store });
const knowledge = () =>
  createKnowledgeService({ db: t.db, evidence: evidence() });
const draftSvc = () => createDraftService({ db: t.db });
const accountSvc = () => createAccountService({ db: t.db, registry });
const connSvc = () => createConnectionService({ db: t.db, box, registry });
const searchSvc = () => createSearchService({ db: t.db, evidence: evidence() });
const wsSvc = () => createWorkspaceService({ db: t.db });

interface Seeded {
  conn: string;
  account: string;
  conv: string;
  evidenceId: string;
  project: string;
  draft: string;
}

const NOW = new Date("2026-11-22T08:00:00Z");

async function seed(workspaceId: string, tag: string, word: string) {
  const [c] = await t.db
    .insert(providerConnections)
    .values({
      workspaceId,
      provider: "limited",
      label: `c-${tag}`,
      credentialsEnc: box.encrypt(`KEY-${tag}`),
    })
    .returning();
  const [a] = await t.db
    .insert(socialAccounts)
    .values({
      connectionId: c!.id,
      platform: "facebook",
      externalId: `p-${tag}`,
      displayName: tag,
    })
    .returning();
  const [cv] = await t.db
    .insert(conversations)
    .values({
      workspaceId,
      socialAccountId: a!.id,
      externalId: `conv-${tag}`,
      participantId: "u",
      participantName: "Lan",
    })
    .returning();
  const ev = await evidence().ingestAsSystem({
    workspaceId,
    source: "document",
    externalId: `d-${tag}`,
    content: `Tài liệu mật của ${tag}: ${word}`,
    contentType: "text/markdown",
    observedAt: NOW,
  });
  const p = await knowledge().createProject({
    actorId: `admin-${tag}`,
    workspaceId,
    name: `Dự án ${tag}`,
  });
  const d = await draftSvc().create({
    actorId: `member-${tag}`,
    workspaceId,
    conversationId: cv!.id,
    text: `Nháp của ${tag}`,
  });
  return {
    conn: c!.id,
    account: a!.id,
    conv: cv!.id,
    evidenceId: ev.itemId,
    project: p.id,
    draft: d.id,
  } satisfies Seeded;
}

beforeEach(async () => {
  t = await createTestDb();
  const [a] = await t.db.insert(workspaces).values({ name: "A" }).returning();
  const [b] = await t.db.insert(workspaces).values({ name: "B" }).returning();
  wsA = a!.id;
  wsB = b!.id;
  await t.db.insert(members).values(
    (["owner", "admin", "member"] as const).flatMap((role) => [
      { workspaceId: wsA, userId: `${role}-A`, role },
      { workspaceId: wsB, userId: `${role}-B`, role },
    ]),
  );
  A = await seed(wsA, "A", "xanhla");
  B = await seed(wsB, "B", "zebrabi");
});
afterEach(async () => {
  await t.client.close();
});

/** Từ chối phải là NotFound (id lạ/khác workspace) hoặc Forbidden (không có quyền) — không bao giờ thành công, không lỗi 500. */
async function denied(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e, "phải bị từ chối").not.toBeNull();
  expect(
    e instanceof NotFoundError || e instanceof ForbiddenError,
    `lỗi không đúng loại: ${String(e)}`,
  ).toBe(true);
}

/** Người tấn công: admin của workspace A (quyền cao nhất trong A ngoài owner) dùng id của B. */
const atk = { actorId: "admin-A" };

describe("api1-bola: id của workspace khác dùng trong workspace của mình", () => {
  it("api1-bola accounts/connections: không xoá, không đọc khoá, không đổi bí mật webhook của B", async () => {
    await denied(
      accountSvc().remove({ ...atk, workspaceId: wsA, accountId: B.account }),
    );
    await denied(
      connSvc().remove({ ...atk, workspaceId: wsA, connectionId: B.conn }),
    );
    await denied(
      connSvc().setWebhookSecret({
        ...atk,
        workspaceId: wsA,
        connectionId: B.conn,
        secret: "x".repeat(32),
      }),
    );
    await denied(
      connSvc().credentialsFor({ workspaceId: wsA, connectionId: B.conn }),
    );
    const [still] = await t.db
      .select({ n: count() })
      .from(providerConnections)
      .where(eq(providerConnections.id, B.conn));
    expect(still!.n).toBe(1);
    const accs = await t.db
      .select({ n: count() })
      .from(socialAccounts)
      .where(eq(socialAccounts.id, B.account));
    expect(accs[0]!.n).toBe(1);
    // danh sách của A không lẫn của B
    const mine = await connSvc().list({ ...atk, workspaceId: wsA });
    expect(mine.map((c) => c.id)).toEqual([A.conn]);
  });

  it("api1-bola evidence: không đọc metadata/nội dung bản gốc của B", async () => {
    await denied(
      evidence().get({ ...atk, workspaceId: wsA, itemId: B.evidenceId }),
    );
    await denied(
      evidence().getContent({ ...atk, workspaceId: wsA, itemId: B.evidenceId }),
    );
    // đối chứng: chính A đọc được của A
    const own = await evidence().getContent({
      ...atk,
      workspaceId: wsA,
      itemId: A.evidenceId,
    });
    expect(new TextDecoder().decode(own.content)).toContain("xanhla");
  });

  it("api1-bola drafts: không xem, sửa, huỷ, liệt kê hay tạo nháp lên hội thoại của B", async () => {
    const w = { ...atk, workspaceId: wsA };
    await denied(draftSvc().get({ ...w, draftId: B.draft }));
    await denied(
      draftSvc().edit({
        ...w,
        draftId: B.draft,
        baseVersion: 1,
        text: "bị sửa",
      }),
    );
    await denied(draftSvc().discard({ ...w, draftId: B.draft }));
    // danh sách lọc theo workspace: hội thoại của B cho kết quả rỗng, không lộ nháp của B
    expect(
      await draftSvc().listForConversation({ ...w, conversationId: B.conv }),
    ).toEqual([]);
    await denied(
      draftSvc().create({ ...w, conversationId: B.conv, text: "chèn nháp" }),
    );
    const [row] = await t.db
      .select({ status: drafts.status, v: drafts.currentVersion })
      .from(drafts)
      .where(eq(drafts.id, B.draft));
    expect(row).toEqual({ status: "open", v: 1 });
    const [n] = await t.db
      .select({ n: count() })
      .from(drafts)
      .where(eq(drafts.conversationId, B.conv));
    expect(n!.n).toBe(1);
  });

  it("api1-bola knowledge: dự án, bí danh, quyết định, liên kết của B không chạm được", async () => {
    const w = { ...atk, workspaceId: wsA };
    await denied(
      knowledge().addAlias({ ...w, projectId: B.project, alias: "x" }),
    );
    await denied(knowledge().timeline({ ...w, projectId: B.project }));
    await denied(knowledge().profile({ ...w, projectId: B.project }));
    await denied(knowledge().listDecisions({ ...w, projectId: B.project }));
    await denied(
      knowledge().recordDecision({
        ...w,
        projectId: A.project,
        text: "chốt",
        sourceEvidenceItemId: B.evidenceId,
      }),
    );
    await denied(
      knowledge().link({
        ...w,
        projectId: B.project,
        target: { type: "conversation", conversationId: A.conv },
      }),
    );
    await denied(
      knowledge().link({
        ...w,
        projectId: A.project,
        target: { type: "conversation", conversationId: B.conv },
      }),
    );
    await denied(
      knowledge().link({
        ...w,
        projectId: A.project,
        target: { type: "evidence", evidenceItemId: B.evidenceId },
      }),
    );
    const mine = await knowledge().list(w);
    expect(mine.map((p) => p.id)).toEqual([A.project]);
  });

  it("api1-bola workspace: cấu hình của B không đọc/sửa được qua workspace của mình", async () => {
    const before = await wsSvc().getRetention({ ...atk, workspaceId: wsA });
    expect(before.days).toBeNull();
    const [b] = await t.db
      .select({ r: workspaces.inboxRetentionDays })
      .from(workspaces)
      .where(eq(workspaces.id, wsB));
    // owner của A đặt thời hạn trong A: B không đổi
    await wsSvc().setRetention({
      actorId: "owner-A",
      workspaceId: wsA,
      days: 30,
      forever: false,
    });
    const [after] = await t.db
      .select({ r: workspaces.inboxRetentionDays })
      .from(workspaces)
      .where(eq(workspaces.id, wsB));
    expect(after).toEqual(b);
    const [p] = await t.db
      .select({ n: count() })
      .from(projects)
      .where(and(eq(projects.workspaceId, wsB)));
    expect(p!.n).toBe(1);
  });

  it("api1-bola workspaceId của B với tư cách người của A: mọi đường đọc/ghi đều Forbidden", async () => {
    const w = { ...atk, workspaceId: wsB };
    await denied(accountSvc().list(w));
    await denied(connSvc().list(w));
    await denied(knowledge().list(w));
    await denied(evidence().get({ ...w, itemId: B.evidenceId }));
    await denied(draftSvc().get({ ...w, draftId: B.draft }));
    await denied(wsSvc().getRetention(w));
    await denied(wsSvc().getAiCloud(w));
    await denied(wsSvc().getOutbound(w));
    await denied(searchSvc().search({ ...w, query: "zebrabi" }));
    await denied(
      wsSvc().setRetention({
        ...w,
        actorId: "owner-A",
        days: 1,
        forever: false,
      }),
    );
    // đối chứng: người của B vẫn dùng được workspace B
    expect(
      await knowledge().list({ actorId: "admin-B", workspaceId: wsB }),
    ).toHaveLength(1);
  });

  it("api1-bola id không phải UUID hay chuỗi tấn công: NotFound, không lỗi hệ thống", async () => {
    for (const bad of [
      "",
      "1",
      "../../etc/passwd",
      "' or 1=1 --",
      "x".repeat(500),
    ]) {
      await denied(draftSvc().get({ ...atk, workspaceId: wsA, draftId: bad }));
      await denied(evidence().get({ ...atk, workspaceId: wsA, itemId: bad }));
      await denied(
        accountSvc().remove({ ...atk, workspaceId: wsA, accountId: bad }),
      );
    }
    // đối chứng: id hợp lệ của chính A vẫn đọc được
    expect(
      (await draftSvc().get({ ...atk, workspaceId: wsA, draftId: A.draft })).id,
    ).toBe(A.draft);
  });
});

describe("api1-bola: tìm kiếm và RAG lọc theo quyền ngay trong truy vấn", () => {
  it("từ khoá chỉ có ở B → A tìm 0 kết quả; B tìm thấy (đối chứng)", async () => {
    expect(
      await searchSvc().search({ ...atk, workspaceId: wsA, query: "zebrabi" }),
    ).toEqual([]);
    const hitB = await searchSvc().search({
      actorId: "member-B",
      workspaceId: wsB,
      query: "zebrabi",
    });
    expect(hitB.map((h) => h.itemId)).toEqual([B.evidenceId]);
    // tiền tố và không dấu cũng không rò
    expect(
      await searchSvc().search({ ...atk, workspaceId: wsA, query: "zebra" }),
    ).toEqual([]);
  });

  it("lọc dự án: projectId của B trong workspace A là NotFound", async () => {
    await denied(
      searchSvc().search({
        ...atk,
        workspaceId: wsA,
        query: "xanhla",
        projectId: B.project,
      }),
    );
    // đối chứng: projectId của chính A lọc được và thấy tài liệu của A
    const own = await searchSvc().search({
      ...atk,
      workspaceId: wsA,
      query: "xanhla",
      projectId: A.project,
    });
    expect(own.every((h) => h.itemId !== B.evidenceId)).toBe(true);
  });

  it("hỏi đáp: tài liệu chỉ B có → 0 đoạn của B vào ngữ cảnh mô hình và vào câu trả lời", async () => {
    const prompts: string[] = [];
    const model: ModelPort = {
      id: "fake",
      model: "m",
      local: true,
      host: "localhost",
      generate: async (req) => {
        prompts.push(req.user);
        return { text: '{"answer":"đã trả lời","citations":[1]}' };
      },
    };
    const answer = createAnswerService({
      search: searchSvc(),
      ai: createAiGateway({ db: t.db, model }),
    });
    // A hỏi về nội dung chỉ B có: không gọi mô hình, không có nguồn
    const r = await answer.ask({
      actorId: "member-A",
      workspaceId: wsA,
      question: "zebrabi là gì?",
    });
    expect(r).toMatchObject({ answered: false, reason: "no_evidence" });
    expect(prompts).toEqual([]);
    // hỏi nội dung của chính A: ngữ cảnh chứa của A và tuyệt đối không có của B
    const own = await answer.ask({
      actorId: "member-A",
      workspaceId: wsA,
      question: "xanhla là gì?",
    });
    expect(own).toMatchObject({ answered: true });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("xanhla");
    expect(prompts[0]).not.toContain("zebrabi");
    expect(JSON.stringify(own)).not.toContain("zebrabi");
    // người của A không hỏi được trên workspace B
    await denied(
      answer.ask({
        actorId: "member-A",
        workspaceId: wsB,
        question: "zebrabi",
      }),
    );
  });
});

describe("api5-bfla: chức năng vượt vai trò", () => {
  const callerOf = (role: Role | "none") =>
    role === "none" ? "stranger" : `${role}-A`;

  it("api5-bfla ma trận quyền: mỗi hành động đúng vai trò, người ngoài không có gì", () => {
    const expected: Record<Role | "none", number> = {
      none: 0,
      member: 5,
      admin: 12,
      owner: ACTIONS.length,
    };
    for (const role of ["none", "member", "admin", "owner"] as const) {
      const allowed = ACTIONS.filter((a) =>
        can(role === "none" ? null : role, a),
      );
      expect(allowed.length, role).toBe(expected[role]);
    }
    // các hành động nhạy cảm CHỈ dành cho owner
    for (const a of [
      "workspace.delete",
      "workspace.settings",
      "data.erase",
    ] as const) {
      expect(can("admin", a), `admin ${a}`).toBe(false);
      expect(can("member", a), `member ${a}`).toBe(false);
      expect(can("owner", a)).toBe(true);
    }
  });

  it("api5-bfla member không gọi được thao tác quản trị (kết nối, tài khoản, dự án, nhập bằng chứng, giải quyết hành động)", async () => {
    const m = { actorId: "member-A", workspaceId: wsA };
    await denied(
      connSvc().create({
        ...m,
        provider: "limited",
        label: "x",
        apiKey: "k",
      } as never),
    );
    await denied(connSvc().remove({ ...m, connectionId: A.conn }));
    await denied(
      connSvc().setWebhookSecret({
        ...m,
        connectionId: A.conn,
        secret: "x".repeat(32),
      }),
    );
    await denied(accountSvc().remove({ ...m, accountId: A.account }));
    await denied(knowledge().createProject({ ...m, name: "mới" }));
    await denied(
      knowledge().addAlias({ ...m, projectId: A.project, alias: "bí danh" }),
    );
    await denied(
      knowledge().link({
        ...m,
        projectId: A.project,
        target: { type: "conversation", conversationId: A.conv },
      }),
    );
    await denied(
      evidence().ingest({
        ...m,
        source: "document",
        externalId: "mới",
        content: "x",
        contentType: "text/markdown",
        observedAt: NOW,
      }),
    );
    // trạng thái không đổi
    const projs = await knowledge().list(m);
    expect(projs.map((p) => p.id)).toEqual([A.project]);
    const [c] = await t.db
      .select({ n: count() })
      .from(providerConnections)
      .where(eq(providerConnections.id, A.conn));
    expect(c!.n).toBe(1);
  });

  it("api5-bfla admin không đổi được cấu hình workspace (chỉ owner)", async () => {
    const a = { actorId: "admin-A", workspaceId: wsA };
    await denied(wsSvc().setRetention({ ...a, days: 1, forever: false }));
    await denied(wsSvc().setAiCloud({ ...a, enabled: true }));
    await denied(
      wsSvc().setOutbound({ ...a, enabled: true, maxPerHour: 1000 }),
    );
    expect(await wsSvc().getAiCloud(a)).toEqual({ enabled: false });
    expect((await wsSvc().getOutbound(a)).enabled).toBe(false);
    expect((await wsSvc().getRetention(a)).days).toBeNull();
    // đối chứng: owner làm được
    await expect(
      wsSvc().setAiCloud({
        actorId: "owner-A",
        workspaceId: wsA,
        enabled: true,
      }),
    ).resolves.toEqual({ enabled: true });
  });

  it("api5-bfla người không phải thành viên: mọi chức năng đọc/ghi đều Forbidden", async () => {
    for (const role of ["none"] as const) {
      const w = { actorId: callerOf(role), workspaceId: wsA };
      await denied(accountSvc().list(w));
      await denied(connSvc().list(w));
      await denied(knowledge().list(w));
      await denied(evidence().get({ ...w, itemId: A.evidenceId }));
      await denied(draftSvc().get({ ...w, draftId: A.draft }));
      await denied(
        draftSvc().create({ ...w, conversationId: A.conv, text: "x" }),
      );
      await denied(searchSvc().search({ ...w, query: "xanhla" }));
      await denied(wsSvc().getAiCloud(w));
    }
    // đối chứng: thành viên thật của A đọc được
    expect(
      await accountSvc().list({ actorId: "member-A", workspaceId: wsA }),
    ).toHaveLength(1);
  });

  it("api5-bfla vai trò không đổi được bằng cách tự nhận trong đầu vào", async () => {
    // Dịch vụ lấy vai trò từ bảng members theo (workspace, actor), không từ đầu vào: thêm trường `role` giả không có tác dụng.
    const forged = {
      actorId: "member-A",
      workspaceId: wsA,
      role: "owner",
      isAdmin: true,
    } as unknown as { actorId: string; workspaceId: string };
    await denied(wsSvc().setAiCloud({ ...forged, enabled: true }));
    await denied(knowledge().createProject({ ...forged, name: "giả mạo" }));
    expect(await wsSvc().getAiCloud(forged)).toEqual({ enabled: false });
    expect(await knowledge().list(forged)).toHaveLength(1);
  });
});
