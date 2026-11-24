import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

import { asc, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAccountService } from "@/src/accounts/service";
import {
  AUDIT_ACTIONS,
  recordAudit,
  setAuditContextProvider,
} from "@/src/audit/record";
import { ForbiddenError } from "@/src/auth/errors";
import { addMember, changeRole, removeMember } from "@/src/auth/members";
import { createConnectionService } from "@/src/connections/service";
import {
  auditEvents,
  conversations,
  members,
  providerConnections,
  socialAccounts,
  workspaces,
} from "@/src/db/schema";
import { createMemoryBlobStore } from "@/src/evidence/blob-store";
import { createEvidenceService } from "@/src/evidence/service";
import { createKnowledgeService } from "@/src/knowledge/service";
import { createRegistry } from "@/src/providers/registry";
import type { SocialProvider } from "@/src/providers/types";
import { createErasureService } from "@/src/retention/erasure";
import { createSecretBox } from "@/src/security/secret-box";
import { createWorkspaceService } from "@/src/workspaces/service";

import { createTestDb, MIGRATIONS } from "../db/helpers";

let t: Awaited<ReturnType<typeof createTestDb>>;
let ws: string;

const box = createSecretBox(randomBytes(32).toString("base64"));
const provider: SocialProvider = {
  id: "limited",
  label: "Hạn chế",
  support: { facebook: ["dm"] },
};
const registry = createRegistry();
registry.register(provider);
const rows = () =>
  t.db
    .select()
    .from(auditEvents)
    .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id));

beforeEach(async () => {
  setAuditContextProvider(async () => undefined);
  t = await createTestDb();
  const [w] = await t.db.insert(workspaces).values({ name: "A" }).returning();
  ws = w!.id;
  await t.db.insert(members).values([
    { workspaceId: ws, userId: "owner", role: "owner" },
    { workspaceId: ws, userId: "admin", role: "admin" },
    { workspaceId: ws, userId: "member", role: "member" },
  ]);
});
afterEach(async () => {
  setAuditContextProvider(async () => undefined);
  await t.client.close();
});

describe("audit trail chỉ ghi thêm (SEC-LOG-007)", () => {
  async function one() {
    await recordAudit(t.db, {
      workspaceId: ws,
      actorId: "owner",
      action: "workspace.retention_changed",
      targetType: "workspace",
      targetId: ws,
    });
    return (await rows())[0]!;
  }

  it("UPDATE bị từ chối ở tầng CSDL", async () => {
    const r = await one();
    await expect(
      t.db
        .update(auditEvents)
        .set({ outcome: "error" })
        .where(eq(auditEvents.id, r.id)),
    ).rejects.toThrow();
    expect((await rows())[0]!.outcome).toBe("success");
  });

  it("DELETE và TRUNCATE bị từ chối (kể cả vai trò chủ bảng)", async () => {
    await one();
    await expect(t.db.delete(auditEvents)).rejects.toThrow();
    await expect(
      t.db.execute(sql`truncate table audit_events`),
    ).rejects.toThrow();
    await expect(
      t.db.execute(sql`delete from audit_events where true`),
    ).rejects.toThrow();
    expect(await rows()).toHaveLength(1);
  });

  it("xoá workspace không xoá dấu vết (không có khoá ngoại cascade)", async () => {
    await one();
    await t.db.delete(workspaces).where(eq(workspaces.id, ws));
    expect(await rows()).toHaveLength(1);
  });

  it("tên hành động sai dạng bị ràng buộc từ chối", async () => {
    await expect(
      t.db.insert(auditEvents).values({
        workspaceId: ws,
        actorId: "x",
        action: "KhongHopLe",
        targetType: "t",
        outcome: "success",
      }),
    ).rejects.toThrow();
  });

  it("migration lùi gỡ bảng, trigger và hàm; chạy lại được", async () => {
    await t.client.exec(
      readFileSync(`${MIGRATIONS}/0020_audit_events.down.sql`, "utf8").replace(
        /DELETE FROM drizzle\.__drizzle_migrations[^;]*;/,
        "",
      ),
    );
    const left = await t.client.query<{ n: number }>(
      `select count(*)::int as n from pg_proc where proname = 'audit_events_append_only'`,
    );
    expect(left.rows[0]!.n).toBe(0);
    await expect(t.db.select().from(auditEvents)).rejects.toThrow();
  });
});

describe("ngữ cảnh who/where (CMP-AUDIT-002)", () => {
  it("ghi IP, user-agent, request id từ provider; cắt độ dài; lỗi provider không làm hỏng việc ghi", async () => {
    setAuditContextProvider(async () => ({
      sourceIp: "203.0.113.7",
      userAgent: "U".repeat(500),
      requestId: "req-9",
    }));
    await recordAudit(t.db, {
      workspaceId: ws,
      actorId: "owner",
      action: "data.exported",
      targetType: "project",
      reason: "r".repeat(500),
    });
    const r = (await rows())[0]!;
    expect(r).toMatchObject({
      sourceIp: "203.0.113.7",
      requestId: "req-9",
      outcome: "success",
      actorId: "owner",
    });
    expect(r.userAgent!.length).toBe(256);
    expect(r.reason!.length).toBe(200);
    expect(r.createdAt).toBeInstanceOf(Date);
    setAuditContextProvider(async () => {
      throw new Error("ngoài request");
    });
    await recordAudit(t.db, {
      workspaceId: ws,
      actorId: "system",
      action: "data.erased",
      targetType: "project",
    });
    expect(await rows()).toHaveLength(2);
  });
});

describe("mỗi hành động trong danh sách sinh sự kiện (CMP-AUDIT-002)", () => {
  const ws2 = () => createWorkspaceService({ db: t.db });

  it("cấu hình workspace: thời hạn lưu, AI đám mây, gửi tin", async () => {
    await ws2().setRetention({
      actorId: "owner",
      workspaceId: ws,
      days: 30,
      forever: false,
    });
    await ws2().setAiCloud({
      actorId: "owner",
      workspaceId: ws,
      enabled: true,
    });
    await ws2().setOutbound({
      actorId: "owner",
      workspaceId: ws,
      enabled: true,
      maxPerHour: 5,
    });
    const r = await rows();
    expect(r.map((x) => x.action).sort()).toEqual([
      "workspace.ai_cloud_changed",
      "workspace.outbound_changed",
      "workspace.retention_changed",
    ]);
    expect(r.every((x) => x.actorId === "owner" && x.targetId === ws)).toBe(
      true,
    );
    expect(
      r.find((x) => x.action === "workspace.retention_changed")!.reason,
    ).toBe("days=30");
  });

  it("thao tác bị từ chối hoặc không hợp lệ KHÔNG để lại dấu vết thành công", async () => {
    await expect(
      ws2().setAiCloud({ actorId: "admin", workspaceId: ws, enabled: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      ws2().setRetention({
        actorId: "owner",
        workspaceId: ws,
        days: -1,
        forever: false,
      }),
    ).rejects.toThrow();
    expect(await rows()).toEqual([]);
  });

  it("thành viên: thêm, đổi vai, xoá — cùng giao dịch với thay đổi", async () => {
    await addMember(t.db, {
      actorId: "owner",
      workspaceId: ws,
      userId: "newbie",
      role: "member",
    });
    await changeRole(t.db, {
      actorId: "owner",
      workspaceId: ws,
      targetUserId: "newbie",
      newRole: "admin",
    });
    await removeMember(t.db, {
      actorId: "owner",
      workspaceId: ws,
      targetUserId: "newbie",
    });
    const r = await rows();
    expect(r.map((x) => x.action)).toEqual([
      "member.added",
      "member.role_changed",
      "member.removed",
    ]);
    expect(r[1]!.reason).toBe("member->admin");
    // bị từ chối thì không có dòng mới
    await expect(
      addMember(t.db, {
        actorId: "member",
        workspaceId: ws,
        userId: "z",
        role: "member",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await rows()).toHaveLength(3);
  });

  it("kết nối và tài khoản: tạo, đổi secret webhook, xoá", async () => {
    const conns = createConnectionService({ db: t.db, box, registry });
    const accts = createAccountService({ db: t.db, registry });
    const c = await conns.create({
      actorId: "admin",
      workspaceId: ws,
      provider: "limited",
      label: "k",
      credentials: "KEY",
    });
    await conns.setWebhookSecret({
      actorId: "admin",
      workspaceId: ws,
      connectionId: c.id,
      secret: "s".repeat(32),
    });
    const a = await accts.add({
      actorId: "admin",
      workspaceId: ws,
      connectionId: c.id,
      platform: "facebook",
      externalId: "p",
      displayName: "P",
    });
    await accts.remove({ actorId: "admin", workspaceId: ws, accountId: a.id });
    await conns.remove({
      actorId: "admin",
      workspaceId: ws,
      connectionId: c.id,
    });
    const r = await rows();
    expect(r.map((x) => x.action).sort()).toEqual([
      "account.added",
      "account.removed",
      "connection.created",
      "connection.removed",
      "connection.webhook_secret_changed",
    ]);
    // không lộ khoá hay secret trong dấu vết
    expect(JSON.stringify(r)).not.toMatch(/KEY|s{32}/);
  });

  it("xoá và xuất dữ liệu", async () => {
    const evidence = createEvidenceService({
      db: t.db,
      store: createMemoryBlobStore(),
    });
    const erasure = createErasureService({ db: t.db, evidence });
    const p = await createKnowledgeService({ db: t.db }).createProject({
      actorId: "admin",
      workspaceId: ws,
      name: "P",
    });
    const [c] = await t.db
      .insert(providerConnections)
      .values({
        workspaceId: ws,
        provider: "limited",
        label: "c",
        credentialsEnc: box.encrypt("K"),
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
    const [cv] = await t.db
      .insert(conversations)
      .values({
        workspaceId: ws,
        socialAccountId: a!.id,
        externalId: "cv",
        participantId: "u",
        participantName: "Lan",
      })
      .returning();
    const doc = await evidence.ingestAsSystem({
      workspaceId: ws,
      source: "document",
      externalId: "d",
      content: "x",
      contentType: "text/markdown",
      observedAt: new Date("2026-11-22T08:00:00Z"),
    });
    await erasure.exportProject({
      actorId: "admin",
      workspaceId: ws,
      projectId: p.id,
    });
    await erasure.eraseEvidenceItem({
      actorId: "owner",
      workspaceId: ws,
      itemId: doc.itemId,
    });
    await erasure.eraseConversation({
      actorId: "owner",
      workspaceId: ws,
      conversationId: cv!.id,
    });
    await erasure.eraseProject({
      actorId: "owner",
      workspaceId: ws,
      projectId: p.id,
    });
    const r = await rows();
    expect(r.map((x) => x.action).sort()).toEqual([
      "data.erased",
      "data.erased",
      "data.erased",
      "data.exported",
    ]);
    expect(
      r
        .filter((x) => x.action === "data.erased")
        .map((x) => x.targetType)
        .sort(),
    ).toEqual(["conversation", "evidence_item", "project"]);
  });

  it("mọi hành động đã đăng ký đều được phát từ mã nguồn (không có tên mồ côi)", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = `${d}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (p.endsWith(".ts")) files.push(p);
      }
    };
    walk("src");
    const code = files
      .filter((f) => f !== "src/audit/record.ts")
      .map((f) => readFileSync(f, "utf-8"))
      .join("\n");
    for (const a of AUDIT_ACTIONS) expect(code, a).toContain(`"${a}"`);
  });
});
