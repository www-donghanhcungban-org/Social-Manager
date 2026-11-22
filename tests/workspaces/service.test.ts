import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError } from "@/src/auth/errors";
import { createWorkspaceService } from "@/src/workspaces/service";
import { ValidationError } from "@/src/providers/types";
import { members, workspaces } from "@/src/db/schema";

import { createTestDb } from "../db/helpers";

let t: Awaited<ReturnType<typeof createTestDb>>;
const svc = () => createWorkspaceService({ db: t.db });

beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.client.close();
});

describe("create", () => {
  it("tạo workspace và biến người tạo thành owner trong cùng một giao dịch", async () => {
    const ws = await svc().create({ actorId: "u1", name: "Cửa hàng A" });
    expect(ws).toEqual({
      id: expect.any(String),
      name: "Cửa hàng A",
      role: "owner",
    });
    const rows = await t.db.select().from(members);
    expect(rows).toEqual([
      expect.objectContaining({
        workspaceId: ws.id,
        userId: "u1",
        role: "owner",
      }),
    ]);
  });

  it("chuẩn hoá tên NFC, cắt khoảng trắng; từ chối tên rỗng hoặc dài quá 100 ký tự", async () => {
    const ok = await svc().create({ actorId: "u1", name: "  Café " });
    expect(ok.name).toBe("Café");
    for (const name of ["", "   ", "x".repeat(101)]) {
      await expect(
        svc().create({ actorId: "u1", name }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await t.db.select().from(workspaces)).toHaveLength(1);
  });

  it("từ chối khi người tạo đã có 20 workspace (chặn lạm dụng)", async () => {
    for (let i = 0; i < 20; i++)
      await svc().create({ actorId: "u1", name: `W${i}` });
    await expect(
      svc().create({ actorId: "u1", name: "W20" }),
    ).rejects.toMatchObject({ reason: "workspace_limit" });
    // người khác không bị ảnh hưởng
    await expect(
      svc().create({ actorId: "u2", name: "W" }),
    ).resolves.toBeDefined();
  });

  it("actorId rỗng bị từ chối, không tạo gì", async () => {
    await expect(
      svc().create({ actorId: "", name: "W" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await t.db.select().from(workspaces)).toHaveLength(0);
  });
});

describe("listForUser", () => {
  it("chỉ trả workspace mà người đó là thành viên, kèm vai trò, theo tên", async () => {
    const a = await svc().create({ actorId: "u1", name: "B-shop" });
    await svc().create({ actorId: "u2", name: "Của người khác" });
    const c = await svc().create({ actorId: "u1", name: "A-shop" });
    await t.db
      .insert(members)
      .values({ workspaceId: a.id, userId: "u3", role: "member" });
    expect(await svc().listForUser("u1")).toEqual([
      { id: c.id, name: "A-shop", role: "owner" },
      { id: a.id, name: "B-shop", role: "owner" },
    ]);
    expect(await svc().listForUser("u3")).toEqual([
      { id: a.id, name: "B-shop", role: "member" },
    ]);
    expect(await svc().listForUser("không-ai")).toEqual([]);
  });
});

describe("thời hạn lưu (D-010)", () => {
  async function seed() {
    const ws = await svc().create({ actorId: "owner", name: "Shop" });
    await t.db.insert(members).values([
      { workspaceId: ws.id, userId: "admin", role: "admin" },
      { workspaceId: ws.id, userId: "member", role: "member" },
    ]);
    return ws.id;
  }
  const set = (workspaceId: string, over = {}) =>
    svc().setRetention({
      actorId: "owner",
      workspaceId,
      days: 90,
      forever: false,
      ...over,
    });

  it("mặc định 365 ngày; owner đặt số ngày, giữ vô thời hạn, rồi về mặc định", async () => {
    const ws = await seed();
    const get = () =>
      svc().getRetention({ actorId: "member", workspaceId: ws });
    expect(await get()).toEqual({
      effectiveDays: 365,
      days: null,
      forever: false,
    });
    expect(await set(ws)).toEqual({
      effectiveDays: 90,
      days: 90,
      forever: false,
    });
    expect(await set(ws, { forever: true })).toEqual({
      effectiveDays: null,
      days: 90,
      forever: true,
    });
    await set(ws, { days: null });
    expect(await get()).toEqual({
      effectiveDays: 365,
      days: null,
      forever: false,
    });
  });

  it("biên hợp lệ 1 và 36500", async () => {
    const ws = await seed();
    expect((await set(ws, { days: 1 })).days).toBe(1);
    expect((await set(ws, { days: 36_500 })).days).toBe(36_500);
  });

  it("từ chối 0, âm, quá 36500, số lẻ, NaN", async () => {
    const ws = await seed();
    for (const days of [0, -1, 36_501, 1.5, Number.NaN]) {
      await expect(set(ws, { days })).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("admin, member và người ngoài không đổi được; người ngoài không xem được", async () => {
    const ws = await seed();
    for (const actorId of ["admin", "member", "outsider"]) {
      await expect(set(ws, { actorId })).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(
      svc().getRetention({ actorId: "outsider", workspaceId: ws }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const [row] = await t.db.select().from(workspaces);
    expect(row!.inboxRetentionDays).toBeNull();
  });
});
