import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/src/auth/errors";
import { createCoverageService } from "@/src/conversations/coverage";
import {
  conversations,
  members,
  providerConnections,
  socialAccounts,
  sourceCheckpoints,
  workspaces,
} from "@/src/db/schema";
import { createInboxService } from "@/src/inbox/service";
import { SocialApiError } from "@/src/providers/socialapi";
import type { SocialProvider } from "@/src/providers/types";
import { createSecretBox } from "@/src/security/secret-box";

import { createTestDb } from "../db/helpers";

const box = createSecretBox(randomBytes(32).toString("base64"));
const T1 = new Date("2026-11-22T08:00:00Z");
const T2 = new Date("2026-11-22T09:00:00Z");

let t: Awaited<ReturnType<typeof createTestDb>>;
let ws: string;
let acc: string;
let clock: Date;
const cov = () => createCoverageService({ db: t.db, now: () => clock });
const report = (actorId = "member", workspaceId = ws) =>
  cov().report({ actorId, workspaceId });

async function addAccount(workspaceId: string, ext: string, name: string) {
  const [c] = await t.db
    .insert(providerConnections)
    .values({
      workspaceId,
      provider: "stub",
      label: `c-${ext}`,
      credentialsEnc: box.encrypt("k"),
    })
    .returning();
  const [a] = await t.db
    .insert(socialAccounts)
    .values({
      connectionId: c!.id,
      platform: "facebook",
      externalId: ext,
      displayName: name,
    })
    .returning();
  return a!.id;
}

beforeEach(async () => {
  t = await createTestDb();
  clock = T1;
  const [w] = await t.db.insert(workspaces).values({ name: "A" }).returning();
  ws = w!.id;
  await t.db.insert(members).values([
    { workspaceId: ws, userId: "member", role: "member" },
    { workspaceId: ws, userId: "other", role: "member" },
  ]);
  acc = await addAccount(ws, "p1", "Trang Một");
});
afterEach(async () => {
  await t.client.close();
});

describe("báo cáo độ bao phủ", () => {
  it("tài khoản chưa đồng bộ lần nào: neverRun, mọi mốc rỗng", async () => {
    expect(await report()).toEqual([
      {
        socialAccountId: acc,
        displayName: "Trang Một",
        platform: "facebook",
        neverRun: true,
        lastRunAt: null,
        lastSuccessAt: null,
        consecutiveFailures: 0,
        lastErrorCode: null,
        conversationsWithBackfill: 0,
      },
    ]);
  });

  it("thành công đặt mốc và xoá chuỗi lỗi; lỗi liên tiếp đếm lên, giữ lần thành công cuối", async () => {
    await cov().record({ workspaceId: ws, socialAccountId: acc, ok: true });
    clock = T2;
    await cov().record({
      workspaceId: ws,
      socialAccountId: acc,
      ok: false,
      errorCode: "http.500",
    });
    await cov().record({
      workspaceId: ws,
      socialAccountId: acc,
      ok: false,
      errorCode: "http.502",
    });
    expect((await report())[0]).toMatchObject({
      neverRun: false,
      lastRunAt: T2,
      lastSuccessAt: T1,
      consecutiveFailures: 2,
      lastErrorCode: "http.502",
    });
    await cov().record({ workspaceId: ws, socialAccountId: acc, ok: true });
    expect((await report())[0]).toMatchObject({
      lastSuccessAt: T2,
      consecutiveFailures: 0,
      lastErrorCode: null,
    });
  });

  it("mã lỗi lạ (có thể chứa nội dung nhà cung cấp) bị thay bằng upstream_error", async () => {
    await cov().record({
      workspaceId: ws,
      socialAccountId: acc,
      ok: false,
      errorCode: "lỗi: token sk-live-abc sai",
    });
    const [row] = await t.db.select().from(sourceCheckpoints);
    expect(row!.lastErrorCode).toBe("upstream_error");
  });

  it("đếm hội thoại còn lịch sử chưa lấy; nhiều tài khoản; không lẫn workspace khác", async () => {
    const acc2 = await addAccount(ws, "p2", "Trang Hai");
    const [w2] = await t.db
      .insert(workspaces)
      .values({ name: "B" })
      .returning();
    const foreign = await addAccount(w2!.id, "pb", "Của B");
    const mkConv = (
      a: string,
      workspaceId: string,
      ext: string,
      cursor: string | null,
    ) =>
      t.db.insert(conversations).values({
        workspaceId,
        socialAccountId: a,
        externalId: ext,
        participantId: "u",
        participantName: "Lan",
        backfillCursor: cursor,
      });
    await mkConv(acc, ws, "c1", "cur1");
    await mkConv(acc, ws, "c2", "cur2");
    await mkConv(acc, ws, "c3", null);
    await mkConv(foreign, w2!.id, "c4", "cur");
    const rows = await report();
    expect(
      rows.map((r) => [r.displayName, r.conversationsWithBackfill]),
    ).toEqual([
      ["Trang Hai", 0],
      ["Trang Một", 2],
    ]);
    expect(rows.find((r) => r.socialAccountId === acc2)!.neverRun).toBe(true);
    expect(await report("x", w2!.id).catch(() => null)).toBeNull(); // không phải thành viên
  });

  it("người ngoài workspace bị Forbidden", async () => {
    await expect(report("lạ")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("xoá tài khoản xoá mốc theo tầng", async () => {
    await cov().record({ workspaceId: ws, socialAccountId: acc, ok: true });
    await t.db.delete(socialAccounts).where(eq(socialAccounts.id, acc));
    expect(await t.db.select().from(sourceCheckpoints)).toHaveLength(0);
  });
});

describe("đồng bộ ghi mốc bao phủ", () => {
  const svc = (provider: SocialProvider | undefined) =>
    createInboxService({
      db: t.db,
      box,
      resolveProvider: () => provider,
      coverage: cov(),
    });
  const run = (provider: SocialProvider | undefined) =>
    svc(provider).sync({ actorId: "member", workspaceId: ws, accountId: acc });
  const ok = (): SocialProvider => ({
    id: "stub",
    label: "s",
    support: { facebook: ["dm"] },
    listInbox: async () => [],
  });

  it("đồng bộ xong thì có mốc thành công", async () => {
    await run(ok());
    expect((await report())[0]).toMatchObject({
      neverRun: false,
      consecutiveFailures: 0,
      lastSuccessAt: T1,
    });
  });

  it("provider lỗi thì ghi mã an toàn, không lộ nội dung lỗi", async () => {
    const p = ok();
    p.listInbox = vi.fn(async () => {
      throw new SocialApiError("khoá sk-live-xyz sai", 401, "http.401");
    });
    await run(p);
    await run(p);
    expect((await report())[0]).toMatchObject({
      consecutiveFailures: 2,
      lastErrorCode: "http.401",
      lastSuccessAt: null,
    });
    expect(JSON.stringify(await report())).not.toMatch(/sk-live/);
  });

  it("provider không còn đăng ký cũng được ghi là lỗi", async () => {
    await run(undefined);
    expect((await report())[0]).toMatchObject({
      consecutiveFailures: 1,
      lastErrorCode: "provider_unavailable",
    });
  });
});
