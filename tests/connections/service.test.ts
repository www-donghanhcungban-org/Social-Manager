import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/src/auth/errors";
import {
  createConnectionService,
  type ConnectionService,
} from "@/src/connections/service";
import { members, providerConnections, workspaces } from "@/src/db/schema";
import { createDemoProvider } from "@/src/providers/demo";
import { createRegistry } from "@/src/providers/registry";
import { ValidationError } from "@/src/providers/types";
import { createSecretBox } from "@/src/security/secret-box";

import { createTestDb } from "../db/helpers";

let t: Awaited<ReturnType<typeof createTestDb>>;
let svc: ConnectionService;
let ws: string;
let otherWs: string;
const box = createSecretBox(randomBytes(32).toString("base64"));

async function newWs(name: string) {
  const [r] = await t.db.insert(workspaces).values({ name }).returning();
  return r!.id;
}

beforeEach(async () => {
  t = await createTestDb();
  const registry = createRegistry();
  registry.register(createDemoProvider({ now: () => new Date() }));
  svc = createConnectionService({ db: t.db, box, registry });
  ws = await newWs("A");
  otherWs = await newWs("B");
  await t.db.insert(members).values([
    { workspaceId: ws, userId: "owner", role: "owner" },
    { workspaceId: ws, userId: "admin", role: "admin" },
    { workspaceId: ws, userId: "member", role: "member" },
    { workspaceId: otherWs, userId: "outsider", role: "owner" },
  ]);
});
afterEach(async () => {
  await t.client.close();
});

const input = (over = {}) => ({
  actorId: "admin",
  workspaceId: ws,
  provider: "demo",
  label: "chính",
  credentials: "sk-super-secret-123",
  ...over,
});

describe("create", () => {
  it("lưu khoá đã mã hoá, không lộ khoá ở giá trị trả về hay trong DB", async () => {
    const c = await svc.create(input());
    expect(c).toEqual({
      id: expect.any(String),
      workspaceId: ws,
      provider: "demo",
      label: "chính",
      webhookEnabled: false,
      createdAt: expect.any(Date),
    });
    expect(JSON.stringify(c)).not.toContain("sk-super-secret");
    const [row] = await t.db.select().from(providerConnections);
    expect(row!.credentialsEnc).toMatch(/^v1:/);
    expect(row!.credentialsEnc).not.toContain("sk-super-secret");
  });

  it("chỉ owner/admin tạo được; member và người ngoài bị Forbidden, DB không đổi", async () => {
    for (const actorId of ["member", "outsider", "không-ai"]) {
      await expect(svc.create(input({ actorId }))).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    expect(await t.db.select().from(providerConnections)).toHaveLength(0);
  });

  it("từ chối provider chưa đăng ký, nhãn rỗng, khoá rỗng bằng ValidationError", async () => {
    for (const bad of [
      { provider: "khong-co" },
      { label: "   " },
      { credentials: "" },
      { credentials: "   " },
    ]) {
      await expect(svc.create(input(bad))).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
  });

  it("chuẩn hoá nhãn NFC và cắt khoảng trắng; nhãn trùng sau chuẩn hoá bị từ chối", async () => {
    const decomposed = "Café"; // e + dấu sắc rời
    const c = await svc.create(input({ label: `  ${decomposed} ` }));
    expect(c.label).toBe("Café");
    await expect(svc.create(input({ label: "Café" }))).rejects.toMatchObject({
      reason: "duplicate_label",
    });
    await expect(svc.create(input({ label: "Café" }))).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("cùng nhãn ở workspace khác thì được", async () => {
    await svc.create(input());
    await t.db.insert(members).values({
      workspaceId: otherWs,
      userId: "admin",
      role: "admin",
    });
    await expect(
      svc.create(input({ workspaceId: otherWs })),
    ).resolves.toBeDefined();
  });
});

describe("list", () => {
  it("mọi thành viên xem được danh sách, không có trường khoá; người ngoài bị Forbidden", async () => {
    await svc.create(input());
    const list = await svc.list({ actorId: "member", workspaceId: ws });
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0]!).sort()).toEqual(
      [
        "createdAt",
        "id",
        "label",
        "provider",
        "webhookEnabled",
        "workspaceId",
      ].sort(),
    );
    await expect(
      svc.list({ actorId: "outsider", workspaceId: ws }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("không thấy kết nối của workspace khác", async () => {
    await svc.create(input());
    expect(
      await svc.list({ actorId: "outsider", workspaceId: otherWs }),
    ).toEqual([]);
  });
});

describe("remove", () => {
  it("admin xoá được; member thì Forbidden; kết nối workspace khác là NotFound", async () => {
    const c = await svc.create(input());
    await expect(
      svc.remove({ actorId: "member", workspaceId: ws, connectionId: c.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      svc.remove({
        actorId: "outsider",
        workspaceId: otherWs,
        connectionId: c.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await t.db.select().from(providerConnections)).toHaveLength(1);
    await svc.remove({ actorId: "admin", workspaceId: ws, connectionId: c.id });
    expect(await t.db.select().from(providerConnections)).toHaveLength(0);
  });

  it("id không phải UUID là NotFound, không phải lỗi SQL", async () => {
    await expect(
      svc.remove({
        actorId: "admin",
        workspaceId: ws,
        connectionId: "'; drop",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("credentialsFor (dùng nội bộ để gọi provider)", () => {
  it("giải mã đúng khoá của đúng workspace", async () => {
    const c = await svc.create(input());
    await expect(
      svc.credentialsFor({ workspaceId: ws, connectionId: c.id }),
    ).resolves.toBe("sk-super-secret-123");
  });

  it("không giải mã được kết nối của workspace khác", async () => {
    const c = await svc.create(input());
    await expect(
      svc.credentialsFor({ workspaceId: otherWs, connectionId: c.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("dữ liệu bị sửa trong DB thì báo lỗi, không trả rác", async () => {
    const c = await svc.create(input());
    await t.client.query(
      `update provider_connections set credentials_enc = 'v1:AAAA' where id = $1`,
      [c.id],
    );
    await expect(
      svc.credentialsFor({ workspaceId: ws, connectionId: c.id }),
    ).rejects.toThrow();
  });
});
