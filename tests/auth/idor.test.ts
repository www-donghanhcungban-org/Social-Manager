import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAccountService } from "@/src/accounts/service";
import { ForbiddenError, NotFoundError } from "@/src/auth/errors";
import { createConnectionService } from "@/src/connections/service";
import {
  inboxItems,
  members,
  posts,
  providerConnections,
  socialAccounts,
  workspaces,
} from "@/src/db/schema";
import { createInboxService } from "@/src/inbox/service";
import { createPostService } from "@/src/posts/service";
import { createDemoProvider } from "@/src/providers/demo";
import { createRegistry } from "@/src/providers/registry";
import { createSecretBox } from "@/src/security/secret-box";

import { createTestDb } from "../db/helpers";

/**
 * IDOR (BE-AUTH-010): mọi thao tác theo ID mà người ở workspace B dùng ID của workspace A đều phải
 * bị từ chối như "không tồn tại", và dữ liệu của A không đổi. Mỗi tài nguyên có ID đều có mặt ở đây.
 */
const box = createSecretBox(randomBytes(32).toString("base64"));
let t: Awaited<ReturnType<typeof createTestDb>>;
let wsA: string;
let wsB: string;
let connA: string;
let accA: string;
let itemA: string;

const registry = createRegistry();
registry.register(createDemoProvider({ now: () => new Date() }));
const resolveProvider = () => createDemoProvider({ now: () => new Date() });

const svc = () => ({
  accounts: createAccountService({ db: t.db, registry }),
  connections: createConnectionService({ db: t.db, box, registry }),
  posts: createPostService({ db: t.db, box, resolveProvider }),
  inbox: createInboxService({ db: t.db, box, resolveProvider }),
});

beforeEach(async () => {
  t = await createTestDb();
  const [a] = await t.db.insert(workspaces).values({ name: "A" }).returning();
  const [b] = await t.db.insert(workspaces).values({ name: "B" }).returning();
  wsA = a!.id;
  wsB = b!.id;
  await t.db.insert(members).values([
    { workspaceId: wsA, userId: "ownerA", role: "owner" },
    { workspaceId: wsB, userId: "ownerB", role: "owner" },
  ]);
  const [c] = await t.db
    .insert(providerConnections)
    .values({
      workspaceId: wsA,
      provider: "demo",
      label: "kết nối A",
      credentialsEnc: box.encrypt("KHOA-A"),
    })
    .returning();
  connA = c!.id;
  const [acc] = await t.db
    .insert(socialAccounts)
    .values({
      connectionId: connA,
      platform: "facebook",
      externalId: "pageA",
      displayName: "Trang A",
    })
    .returning();
  accA = acc!.id;
  await svc().inbox.sync({
    actorId: "ownerA",
    workspaceId: wsA,
    accountId: accA,
  });
  const [item] = await t.db.select().from(inboxItems);
  itemA = item!.id;
});
afterEach(async () => {
  await t.client.close();
});

const snapshot = async () => ({
  conns: await t.db.select().from(providerConnections),
  accounts: await t.db.select().from(socialAccounts),
  items: await t.db.select().from(inboxItems),
  posts: await t.db.select().from(posts),
});

describe("người dùng B (chủ workspace B) dùng ID của workspace A", () => {
  it.each([
    [
      "xoá kết nối",
      (s: ReturnType<typeof svc>) =>
        s.connections.remove({
          actorId: "ownerB",
          workspaceId: wsB,
          connectionId: connA,
        }),
    ],
    [
      "đọc khoá kết nối",
      (s: ReturnType<typeof svc>) =>
        s.connections.credentialsFor({ workspaceId: wsB, connectionId: connA }),
    ],
    [
      "xoá tài khoản",
      (s: ReturnType<typeof svc>) =>
        s.accounts.remove({
          actorId: "ownerB",
          workspaceId: wsB,
          accountId: accA,
        }),
    ],
    [
      "thêm tài khoản vào kết nối của A",
      (s: ReturnType<typeof svc>) =>
        s.accounts.add({
          actorId: "ownerB",
          workspaceId: wsB,
          connectionId: connA,
          platform: "facebook",
          externalId: "xam-nhap",
          displayName: "Xâm nhập",
        }),
    ],
    [
      "đồng bộ hộp thư tài khoản của A",
      (s: ReturnType<typeof svc>) =>
        s.inbox.sync({ actorId: "ownerB", workspaceId: wsB, accountId: accA }),
    ],
    [
      "đổi trạng thái tin của A",
      (s: ReturnType<typeof svc>) =>
        s.inbox.setStatus({
          actorId: "ownerB",
          workspaceId: wsB,
          itemId: itemA,
          status: "handled",
        }),
    ],
    [
      "đăng bài bằng tài khoản của A",
      (s: ReturnType<typeof svc>) =>
        s.posts.schedule({
          actorId: "ownerB",
          workspaceId: wsB,
          accountId: accA,
          text: "bài xâm nhập",
          idempotencyKey: "k-1",
        }),
    ],
  ])("%s → NotFound, dữ liệu không đổi", async (_name, op) => {
    const before = await snapshot();
    await expect(op(svc())).rejects.toBeInstanceOf(NotFoundError);
    expect(await snapshot()).toEqual(before);
  });

  // Hai tầng nhất quán: cổng workspace luôn 403 (người ngoài và thiếu quyền giống nhau, không lộ
  // workspace có tồn tại); lỗi theo ID trong workspace của mình luôn 404.
  it("đọc danh sách ở workspace A (không phải thành viên) → Forbidden, không lộ gì", async () => {
    const s = svc();
    const calls = [
      s.accounts.list({ actorId: "ownerB", workspaceId: wsA }),
      s.connections.list({ actorId: "ownerB", workspaceId: wsA }),
      s.inbox.list({ actorId: "ownerB", workspaceId: wsA }),
      s.posts.list({ actorId: "ownerB", workspaceId: wsA }),
    ];
    for (const c of calls)
      await expect(c).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("danh sách ở workspace B không chứa dữ liệu của A", async () => {
    const s = svc();
    expect(
      await s.accounts.list({ actorId: "ownerB", workspaceId: wsB }),
    ).toEqual([]);
    expect(
      await s.connections.list({ actorId: "ownerB", workspaceId: wsB }),
    ).toEqual([]);
    const inbox = await s.inbox.list({ actorId: "ownerB", workspaceId: wsB });
    expect(inbox.items).toEqual([]);
  });

  it("chính chủ A vẫn thao tác được (đối chứng, tránh test xanh vì lỗi chung)", async () => {
    const r = await svc().inbox.setStatus({
      actorId: "ownerA",
      workspaceId: wsA,
      itemId: itemA,
      status: "handled",
    });
    expect(r.status).toBe("handled");
    const [row] = await t.db
      .select()
      .from(inboxItems)
      .where(eq(inboxItems.id, itemA));
    expect(row?.status).toBe("handled");
  });
});

describe("danh tính lấy từ phiên, không từ body (BE-AUTH-009)", () => {
  const actionFiles = () =>
    execFileSync("git", ["ls-files", "app"], { encoding: "utf-8" })
      .split("\n")
      .filter((f) => /\/actions\.ts$/.test(f));

  it("không Server Action nào đọc userId/actorId/workspace owner từ formData hay tham số", () => {
    const files = actionFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(f, "utf-8");
      expect(src, f).not.toMatch(
        /(formData|form|body|input)\.get\(\s*["'`](userId|actorId|user_id|actor_id)["'`]/,
      );
      // actor luôn đến từ phiên đăng nhập
      if (/actorId\s*:/.test(src))
        expect(src, f).toMatch(/requireUser|requireWorkspace/);
    }
  });

  it("mọi Server Action bắt đầu bằng 'use server' và gọi requireUser/requireWorkspace", () => {
    for (const f of actionFiles()) {
      const src = readFileSync(f, "utf-8");
      expect(src, f).toMatch(/^"use server"/m);
      expect(src, f).toMatch(/requireUser|requireWorkspace/);
    }
  });
});
