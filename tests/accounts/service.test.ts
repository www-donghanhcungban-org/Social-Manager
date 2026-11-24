import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/src/auth/errors";
import { createAccountService } from "@/src/accounts/service";
import { createConnectionService } from "@/src/connections/service";
import { members, socialAccounts, workspaces } from "@/src/db/schema";
import { createRegistry } from "@/src/providers/registry";
import { ValidationError, type SocialProvider } from "@/src/providers/types";
import { createSecretBox } from "@/src/security/secret-box";

import { createTestDb } from "../db/helpers";

let t: Awaited<ReturnType<typeof createTestDb>>;
let ws: string;
let otherWs: string;
let conn: string;
let foreignConn: string;

const limited: SocialProvider = {
  id: "limited",
  label: "Hạn chế",
  support: { facebook: ["publish"], telegram: ["dm"] },
};

function build() {
  const registry = createRegistry();
  registry.register(limited);
  const box = createSecretBox(randomBytes(32).toString("base64"));
  return {
    accounts: createAccountService({ db: t.db, registry }),
    connections: createConnectionService({ db: t.db, box, registry }),
  };
}

beforeEach(async () => {
  t = await createTestDb();
  const [a] = await t.db.insert(workspaces).values({ name: "A" }).returning();
  const [b] = await t.db.insert(workspaces).values({ name: "B" }).returning();
  ws = a!.id;
  otherWs = b!.id;
  await t.db.insert(members).values([
    { workspaceId: ws, userId: "admin", role: "admin" },
    { workspaceId: ws, userId: "member", role: "member" },
    { workspaceId: otherWs, userId: "outsider", role: "owner" },
  ]);
  const { connections } = build();
  conn = (
    await connections.create({
      actorId: "admin",
      workspaceId: ws,
      provider: "limited",
      label: "c1",
      credentials: "k",
    })
  ).id;
  foreignConn = (
    await connections.create({
      actorId: "outsider",
      workspaceId: otherWs,
      provider: "limited",
      label: "c2",
      credentials: "k",
    })
  ).id;
});
afterEach(async () => {
  await t.client.close();
});

const add = (over = {}) =>
  build().accounts.add({
    actorId: "admin",
    workspaceId: ws,
    connectionId: conn,
    platform: "facebook",
    externalId: "page-1",
    displayName: "Trang Một",
    ...over,
  });

describe("add", () => {
  it("thêm tài khoản vào kết nối; trả dạng xem không có khoá [F-002/AC-05]", async () => {
    const a = await add();
    expect(a).toEqual({
      id: expect.any(String),
      connectionId: conn,
      platform: "facebook",
      externalId: "page-1",
      displayName: "Trang Một",
    });
  });

  it("chỉ owner/admin; member và người ngoài bị Forbidden [F-002/AC-03]", async () => {
    for (const actorId of ["member", "outsider", "ai-do"]) {
      await expect(add({ actorId })).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(await t.db.select().from(socialAccounts)).toHaveLength(0);
  });

  it("kết nối của workspace khác hoặc id lạ là NotFound [F-002/AC-05]", async () => {
    await expect(add({ connectionId: foreignConn })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(add({ connectionId: "lạ" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("nền tảng phải thuộc danh sách provider hỗ trợ; nền tảng lạ hoặc ngoài hỗ trợ là ValidationError [F-002/AC-06]", async () => {
    for (const platform of ["tiktok", "__proto__", "khong-co", "constructor"]) {
      await expect(add({ platform })).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(add({ platform: "telegram" })).resolves.toBeDefined();
  });

  it("từ chối externalId/tên rỗng; chuẩn hoá NFC và cắt khoảng trắng [F-002/AC-05]", async () => {
    for (const bad of [
      { externalId: "  " },
      { displayName: "" },
      { externalId: "x".repeat(201) },
      { displayName: "x".repeat(201) },
    ]) {
      await expect(add(bad)).rejects.toBeInstanceOf(ValidationError);
    }
    const a = await add({ externalId: " p2 ", displayName: " Café " });
    expect(a.externalId).toBe("p2");
    expect(a.displayName).toBe("Café");
  });

  it("trùng (kết nối, nền tảng, id ngoài) là ConflictError duplicate_account [F-002/AC-05]", async () => {
    await add();
    await expect(add()).rejects.toMatchObject({ reason: "duplicate_account" });
    await expect(add()).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("list", () => {
  it("thành viên xem được, kèm nhãn kết nối; người ngoài bị Forbidden; không thấy workspace khác", async () => {
    await add();
    const rows = await build().accounts.list({
      actorId: "member",
      workspaceId: ws,
    });
    expect(rows).toEqual([
      {
        id: expect.any(String),
        connectionId: conn,
        connectionLabel: "c1",
        provider: "limited",
        platform: "facebook",
        externalId: "page-1",
        displayName: "Trang Một",
      },
    ]);
    await expect(
      build().accounts.list({ actorId: "outsider", workspaceId: ws }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      await build().accounts.list({
        actorId: "outsider",
        workspaceId: otherWs,
      }),
    ).toEqual([]);
  });
});

describe("remove", () => {
  it("admin xoá được; member Forbidden; id lạ hoặc workspace khác NotFound [F-002/AC-03]", async () => {
    const a = await add();
    const svc = build().accounts;
    await expect(
      svc.remove({ actorId: "member", workspaceId: ws, accountId: a.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      svc.remove({
        actorId: "outsider",
        workspaceId: otherWs,
        accountId: a.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      svc.remove({ actorId: "admin", workspaceId: ws, accountId: "lạ" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await svc.remove({ actorId: "admin", workspaceId: ws, accountId: a.id });
    expect(await t.db.select().from(socialAccounts)).toHaveLength(0);
  });
});
