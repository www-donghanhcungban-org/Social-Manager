import { and, eq } from "drizzle-orm";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAiGateway } from "@/src/ai/gateway";
import { AiNotAllowedError, type ModelPort } from "@/src/ai/port";
import {
  ConflictError,
  ForbiddenError,
  TooManyAttemptsError,
} from "@/src/auth/errors";
import { hashPassword } from "@/src/auth/password";
import { createLoginThrottle } from "@/src/auth/throttle";
import {
  account,
  auditEvents,
  consents,
  evidenceItems,
  members,
  session,
  user,
  workspaces,
} from "@/src/db/schema";
import { createMemoryBlobStore } from "@/src/evidence/blob-store";
import { createEvidenceService } from "@/src/evidence/service";
import { createLogger } from "@/src/log/logger";
import { createAccountRightsService } from "@/src/retention/account";
import {
  CONSENT_POLICY_VERSION,
  consentTextHash,
  currentConsent,
} from "@/src/workspaces/consent";
import { createWorkspaceService } from "@/src/workspaces/service";

import { createTestDb } from "../db/helpers";

const PASSWORD = "mat-khau-du-dai-123";
const NOW = new Date("2026-11-24T08:00:00Z");

let t: Awaited<ReturnType<typeof createTestDb>>;
let store: ReturnType<typeof createMemoryBlobStore>;
let evidence: ReturnType<typeof createEvidenceService>;

let logLines: string[] = [];
const rights = () =>
  createAccountRightsService({
    db: t.db,
    evidence,
    now: () => NOW,
    throttle: createLoginThrottle({ db: t.db, secret: "t".repeat(32) }),
    log: createLogger({
      service: "t",
      version: "0",
      env: "test",
      write: (line) => logLines.push(line),
    }),
  });
const wsSvc = () => createWorkspaceService({ db: t.db, now: () => NOW });

async function makeUser(id: string, email: string) {
  await t.db
    .insert(user)
    .values({ id, name: `Tên ${id}`, email, emailVerified: false });
  await t.db.insert(account).values({
    id: `acc-${id}`,
    accountId: id,
    providerId: "credential",
    userId: id,
    password: await hashPassword(PASSWORD),
    updatedAt: NOW,
  });
  await t.db.insert(session).values({
    id: `sess-${id}`,
    token: `tok-${id}`,
    userId: id,
    ipAddress: "203.0.113.7",
    userAgent: "Thử/1.0",
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    updatedAt: NOW,
  });
}

async function makeWorkspace(name: string) {
  const [w] = await t.db.insert(workspaces).values({ name }).returning();
  return w!.id;
}
const doc = (ws: string, ext: string, content: string) =>
  evidence.ingestAsSystem({
    workspaceId: ws,
    source: "document",
    externalId: ext,
    content,
    contentType: "text/markdown",
    observedAt: NOW,
  });

beforeEach(async () => {
  t = await createTestDb();
  store = createMemoryBlobStore();
  evidence = createEvidenceService({ db: t.db, store });
  await makeUser("u1", "lan@example.com");
  await makeUser("u2", "binh@example.com");
});
afterEach(async () => {
  await t.client.close();
});

describe("rights-access: xem và xuất dữ liệu của chính mình (STD-PRIV-004)", () => {
  it("xuất hồ sơ, thành viên, đồng ý, phiên, hành động của mình; không có mã phiên, mật khẩu hay dữ liệu người khác", async () => {
    const ws = await makeWorkspace("Cửa hàng A");
    await t.db.insert(members).values([
      { workspaceId: ws, userId: "u1", role: "owner" },
      { workspaceId: ws, userId: "u2", role: "member" },
    ]);
    await wsSvc().setAiCloud({ actorId: "u1", workspaceId: ws, enabled: true });

    const out = await rights().exportMyData({ userId: "u1" });
    expect(out.profile).toMatchObject({
      name: "Tên u1",
      email: "lan@example.com",
    });
    expect(out.memberships).toEqual([
      { workspaceId: ws, workspaceName: "Cửa hàng A", role: "owner" },
    ]);
    expect(out.consents).toMatchObject([
      { purpose: "ai_cloud", policyVersion: CONSENT_POLICY_VERSION },
    ]);
    expect(out.sessions).toMatchObject([
      { ipAddress: "203.0.113.7", userAgent: "Thử/1.0" },
    ]);
    expect(out.auditEvents.map((a) => a.action)).toContain(
      "workspace.ai_cloud_changed",
    );

    const text = JSON.stringify(out);
    expect(text).not.toMatch(/tok-u1|\$argon2|binh@example\.com|Tên u2/);
    // Việc xuất cũng để lại dấu vết.
    const audit = await t.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "data.exported"));
    expect(audit).toHaveLength(1);
  });

  it("người dùng không tồn tại: từ chối, không rò gì", async () => {
    await expect(
      rights().exportMyData({ userId: "không-có" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("rights-delete: xoá tài khoản tự phục vụ, lan mọi bản sao (CMP-PRIV-005, CMP-RIGHTS-007)", () => {
  it("sai mật khẩu hoặc rỗng: từ chối, không xoá gì", async () => {
    for (const password of ["sai-mat-khau-1234", ""])
      await expect(
        rights().deleteAccount({ userId: "u1", password }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await t.db.select().from(user)).toHaveLength(2);
  });

  // AUD-CODE-008: bước nhập lại mật khẩu là một phép dò mật khẩu cho ai giữ phiên; phải bị giới hạn như đăng nhập.
  it("dò mật khẩu: sai nhiều lần thì bị khoá, dù sau đó nhập đúng cũng không xoá được", async () => {
    for (let i = 0; i < 5; i++)
      await expect(
        rights().deleteAccount({ userId: "u1", password: `sai-lan-${i}-xxxx` }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      rights().deleteAccount({ userId: "u1", password: PASSWORD }),
    ).rejects.toBeInstanceOf(TooManyAttemptsError);
    expect(
      await t.db.select().from(user).where(eq(user.id, "u1")),
    ).toHaveLength(1);
  });

  it("ghi sự kiện bảo mật khi sai mật khẩu và khi bị khoá, không lộ mật khẩu", async () => {
    logLines = [];
    for (let i = 0; i < 5; i++)
      await rights()
        .deleteAccount({ userId: "u1", password: `sai-lan-${i}-xxxx` })
        .catch(() => {});
    await rights()
      .deleteAccount({ userId: "u1", password: PASSWORD })
      .catch(() => {});
    const events = logLines.map(
      (l) => JSON.parse(l) as Record<string, unknown>,
    );
    expect(events.filter((e) => e.event === "auth.login_failed")).toHaveLength(
      5,
    );
    expect(events.filter((e) => e.event === "auth.login_locked")).toHaveLength(
      1,
    );
    for (const e of events) {
      expect(e).toMatchObject({
        actor: "u1",
        target_type: "account_delete",
        outcome: "denied",
      });
    }
    expect(logLines.join("\n")).not.toContain(PASSWORD);
    expect(logLines.join("\n")).not.toContain("sai-lan-");
  });

  it("đúng mật khẩu xoá bộ đếm: vài lần sai rồi đúng thì xoá được", async () => {
    for (let i = 0; i < 3; i++)
      await expect(
        rights().deleteAccount({ userId: "u1", password: `sai-lan-${i}-xxxx` }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    await rights().deleteAccount({ userId: "u1", password: PASSWORD });
    expect(
      await t.db.select().from(user).where(eq(user.id, "u1")),
    ).toHaveLength(0);
  });

  it("workspace chỉ có mình: xoá cùng bằng chứng, blob, đồng ý; workspace còn người khác: chỉ gỡ khỏi danh sách; audit còn", async () => {
    const solo = await makeWorkspace("Một mình");
    const shared = await makeWorkspace("Chung");
    await t.db.insert(members).values([
      { workspaceId: solo, userId: "u1", role: "owner" },
      { workspaceId: shared, userId: "u1", role: "member" },
      { workspaceId: shared, userId: "u2", role: "owner" },
    ]);
    await doc(solo, "d1", "nội dung riêng của Lan");
    await doc(shared, "d2", "nội dung chung");
    await wsSvc().setAiCloud({
      actorId: "u1",
      workspaceId: solo,
      enabled: true,
    });
    expect(store.size).toBe(2);

    const r = await rights().deleteAccount({
      userId: "u1",
      password: PASSWORD,
    });
    expect(r).toMatchObject({
      workspacesDeleted: 1,
      membershipsRemoved: 1,
      consents: 1,
      sessions: 1,
      blobs: 1,
    });

    // Truy vấn từng kho: người dùng, đăng nhập, phiên, thành viên, đồng ý, workspace, bằng chứng, blob.
    expect(await t.db.select().from(user).where(eq(user.id, "u1"))).toEqual([]);
    expect(
      await t.db.select().from(account).where(eq(account.userId, "u1")),
    ).toEqual([]);
    expect(
      await t.db.select().from(session).where(eq(session.userId, "u1")),
    ).toEqual([]);
    expect(
      await t.db.select().from(members).where(eq(members.userId, "u1")),
    ).toEqual([]);
    expect(await t.db.select().from(consents)).toEqual([]);
    expect(
      await t.db.select().from(workspaces).where(eq(workspaces.id, solo)),
    ).toEqual([]);
    expect(
      await t.db
        .select()
        .from(evidenceItems)
        .where(eq(evidenceItems.workspaceId, solo)),
    ).toEqual([]);
    expect(store.size).toBe(1);

    // Workspace chung và người còn lại nguyên vẹn.
    expect(
      await t.db.select().from(workspaces).where(eq(workspaces.id, shared)),
    ).toHaveLength(1);
    expect(
      await t.db.select().from(members).where(eq(members.userId, "u2")),
    ).toHaveLength(1);
    expect(
      await t.db.select().from(user).where(eq(user.id, "u2")),
    ).toHaveLength(1);

    // Căn cứ giữ lại: sổ audit ghi việc xoá, actor chỉ còn là mã.
    const erased = await t.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.actorId, "u1"),
          eq(auditEvents.reason, "account_deleted"),
        ),
      );
    expect(erased.map((a) => a.action).sort()).toEqual([
      "data.erased",
      "member.removed",
    ]);
  });

  it("tệp nội dung dùng chung hash với workspace khác thì giữ lại; hết nơi dùng thì xoá (không để tệp mồ côi)", async () => {
    const solo = await makeWorkspace("Một mình");
    const shared = await makeWorkspace("Chung");
    await t.db.insert(members).values([
      { workspaceId: solo, userId: "u1", role: "owner" },
      { workspaceId: shared, userId: "u2", role: "owner" },
    ]);
    await doc(solo, "a", "cùng một nội dung");
    await doc(shared, "b", "cùng một nội dung");
    expect(store.size).toBe(1);
    await rights().deleteAccount({ userId: "u1", password: PASSWORD });
    expect(store.size).toBe(1);
    await rights().deleteAccount({ userId: "u2", password: PASSWORD });
    expect(store.size).toBe(0);
  });

  it("chủ duy nhất của workspace còn thành viên khác: từ chối và không xoá gì (nguyên tử)", async () => {
    const ws = await makeWorkspace("Có người");
    await t.db.insert(members).values([
      { workspaceId: ws, userId: "u1", role: "owner" },
      { workspaceId: ws, userId: "u2", role: "member" },
    ]);
    const other = await makeWorkspace("Một mình");
    await t.db
      .insert(members)
      .values({ workspaceId: other, userId: "u1", role: "owner" });

    await expect(
      rights().deleteAccount({ userId: "u1", password: PASSWORD }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(
      await t.db.select().from(user).where(eq(user.id, "u1")),
    ).toHaveLength(1);
    expect(await t.db.select().from(workspaces)).toHaveLength(2);
    expect(
      await t.db.select().from(members).where(eq(members.userId, "u1")),
    ).toHaveLength(2);
  });

  it("còn owner khác thì được rời đi", async () => {
    const ws = await makeWorkspace("Hai chủ");
    await t.db.insert(members).values([
      { workspaceId: ws, userId: "u1", role: "owner" },
      { workspaceId: ws, userId: "u2", role: "owner" },
    ]);
    const r = await rights().deleteAccount({
      userId: "u1",
      password: PASSWORD,
    });
    expect(r).toMatchObject({ workspacesDeleted: 0, membershipsRemoved: 1 });
    expect(
      await t.db.select().from(workspaces).where(eq(workspaces.id, ws)),
    ).toHaveLength(1);
  });

  it("tài khoản không có mật khẩu đăng nhập (không có hàng credential): không xoá được bằng mật khẩu bất kỳ", async () => {
    await t.db.delete(account).where(eq(account.userId, "u1"));
    await expect(
      rights().deleteAccount({ userId: "u1", password: PASSWORD }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("rights-withdraw-consent: cấp và rút đồng ý (CMP-RIGHTS-001/004, CMP-VN-001)", () => {
  let ws: string;
  const cloud: ModelPort = {
    id: "fake",
    model: "m",
    local: false,
    host: "api.example.com",
    generate: async () => ({ text: "ok" }),
  };
  const call = () =>
    createAiGateway({ db: t.db, model: cloud }).complete({
      actorId: "u1",
      workspaceId: ws,
      purpose: "answer",
      system: "S",
      user: "U",
      itemCount: 1,
    });

  beforeEach(async () => {
    ws = await makeWorkspace("Đồng ý");
    await t.db
      .insert(members)
      .values({ workspaceId: ws, userId: "u1", role: "owner" });
  });

  it("bật tạo bản ghi đủ trường, băm đúng văn bản đã hiển thị; rút tạo bản ghi MỚI, bản cũ nguyên vẹn", async () => {
    await wsSvc().setAiCloud({ actorId: "u1", workspaceId: ws, enabled: true });
    const [g] = await t.db.select().from(consents);
    expect(g).toMatchObject({
      workspaceId: ws,
      subjectId: "u1",
      purposeId: "ai_cloud",
      policyVersion: CONSENT_POLICY_VERSION,
      channel: "web",
      uiSnapshotHash: consentTextHash("ai_cloud"),
      withdrawnAt: null,
    });
    expect(g!.grantedAt).toEqual(NOW);

    await wsSvc().setAiCloud({
      actorId: "u1",
      workspaceId: ws,
      enabled: false,
    });
    const rows = await t.db.select().from(consents);
    expect(rows).toHaveLength(2);
    const withdrawn = rows.find((r) => r.withdrawnAt !== null)!;
    expect(withdrawn.id).not.toBe(g!.id);
    expect(withdrawn.grantedAt).toEqual(g!.grantedAt);
    expect(withdrawn.withdrawnAt!.getTime()).toBeGreaterThanOrEqual(
      withdrawn.grantedAt.getTime(),
    );
    // Dòng cấp ban đầu không bị sửa.
    const original = rows.find((r) => r.id === g!.id)!;
    expect(original).toEqual(g);
    expect((await currentConsent(t.db, ws, "ai_cloud")).granted).toBe(false);
  });

  it("rút khi chưa cấp, hoặc rút hai lần: không sinh dòng thừa; bật hai lần: một dòng cấp", async () => {
    await wsSvc().setAiCloud({
      actorId: "u1",
      workspaceId: ws,
      enabled: false,
    });
    expect(await t.db.select().from(consents)).toHaveLength(0);
    await wsSvc().setAiCloud({ actorId: "u1", workspaceId: ws, enabled: true });
    await wsSvc().setAiCloud({ actorId: "u1", workspaceId: ws, enabled: true });
    expect(await t.db.select().from(consents)).toHaveLength(1);
    await wsSvc().setAiCloud({
      actorId: "u1",
      workspaceId: ws,
      enabled: false,
    });
    await wsSvc().setAiCloud({
      actorId: "u1",
      workspaceId: ws,
      enabled: false,
    });
    expect(await t.db.select().from(consents)).toHaveLength(2);
  });

  it("rút đồng ý thì dừng xử lý mục đích đó: cổng AI đám mây chặn, không gọi mô hình; cấp lại thì chạy", async () => {
    await wsSvc().setAiCloud({ actorId: "u1", workspaceId: ws, enabled: true });
    await expect(call()).resolves.toBeDefined();
    await wsSvc().setAiCloud({
      actorId: "u1",
      workspaceId: ws,
      enabled: false,
    });
    await expect(call()).rejects.toBeInstanceOf(AiNotAllowedError);
    await wsSvc().setAiCloud({ actorId: "u1", workspaceId: ws, enabled: true });
    await expect(call()).resolves.toBeDefined();
    const history = await wsSvc().consentHistory({
      actorId: "u1",
      workspaceId: ws,
    });
    expect(history.map((h) => h.withdrawnAt !== null)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("thiếu bản ghi đồng ý: từ chối xử lý dù cờ workspace đang bật (CMP-VN-001)", async () => {
    await t.db.update(workspaces).set({ aiCloudEnabled: true });
    await expect(call()).rejects.toBeInstanceOf(AiNotAllowedError);
  });

  it("chỉ owner xem được lịch sử đồng ý của workspace", async () => {
    await t.db
      .insert(members)
      .values({ workspaceId: ws, userId: "u2", role: "member" });
    await expect(
      wsSvc().consentHistory({ actorId: "u2", workspaceId: ws }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("mã không có đường sửa/xoá bản ghi đồng ý ngoài xoá tài khoản (chỉ ghi thêm)", () => {
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`],
      );
    const offenders = walk("src")
      .filter((f) => f.endsWith(".ts"))
      .filter((f) =>
        /\.(update|delete)\(consents\)/.test(readFileSync(f, "utf-8")),
      );
    expect(offenders).toEqual(["src/retention/account.ts"]);
  });
});
