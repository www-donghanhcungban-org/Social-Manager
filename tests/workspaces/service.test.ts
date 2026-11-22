import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
