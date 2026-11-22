import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError } from "@/src/auth/errors";
import {
  addMember,
  changeRole,
  getRole,
  removeMember,
} from "@/src/auth/members";
import { members, workspaces } from "@/src/db/schema";

import { createTestDb } from "../db/helpers";

async function newWorkspace(name: string): Promise<string> {
  const [row] = await t.db.insert(workspaces).values({ name }).returning();
  if (!row) throw new Error("không tạo được workspace");
  return row.id;
}

let t: Awaited<ReturnType<typeof createTestDb>>;
let ws: string;

beforeEach(async () => {
  t = await createTestDb();
  ws = await newWorkspace("Shop");
  await t.db.insert(members).values([
    { workspaceId: ws, userId: "owner1", role: "owner" },
    { workspaceId: ws, userId: "admin1", role: "admin" },
    { workspaceId: ws, userId: "member1", role: "member" },
  ]);
});
afterEach(async () => {
  await t.client.close();
});

const roleOf = (userId: string, workspaceId = ws) =>
  getRole(t.db, workspaceId, userId);

describe("getRole", () => {
  it("trả vai trò, hoặc null nếu không phải thành viên", async () => {
    expect(await roleOf("admin1")).toBe("admin");
    expect(await roleOf("nguoi-la")).toBeNull();
  });
});

describe("addMember", () => {
  it("owner thêm được admin; admin thêm được member", async () => {
    await addMember(t.db, {
      actorId: "owner1",
      workspaceId: ws,
      userId: "a2",
      role: "admin",
    });
    await addMember(t.db, {
      actorId: "admin1",
      workspaceId: ws,
      userId: "m2",
      role: "member",
    });
    expect(await roleOf("a2")).toBe("admin");
    expect(await roleOf("m2")).toBe("member");
  });

  it("admin không thêm được admin hay owner", async () => {
    for (const role of ["admin", "owner"] as const) {
      await expect(
        addMember(t.db, {
          actorId: "admin1",
          workspaceId: ws,
          userId: "x",
          role,
        }),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    expect(await roleOf("x")).toBeNull();
  });

  it("member và người ngoài không thêm được ai", async () => {
    for (const actorId of ["member1", "nguoi-la"]) {
      await expect(
        addMember(t.db, {
          actorId,
          workspaceId: ws,
          userId: "x",
          role: "member",
        }),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
  });

  it("thêm người đã là thành viên → conflict, vai trò cũ giữ nguyên", async () => {
    await expect(
      addMember(t.db, {
        actorId: "owner1",
        workspaceId: ws,
        userId: "member1",
        role: "admin",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await roleOf("member1")).toBe("member");
  });
});

describe("changeRole", () => {
  it("owner đổi vai trò thành viên", async () => {
    await changeRole(t.db, {
      actorId: "owner1",
      workspaceId: ws,
      targetUserId: "member1",
      newRole: "admin",
    });
    expect(await roleOf("member1")).toBe("admin");
  });

  it("admin, member và người ngoài không đổi được vai trò của ai (kể cả của mình)", async () => {
    for (const [actorId, targetUserId] of [
      ["admin1", "member1"],
      ["admin1", "admin1"],
      ["member1", "member1"],
      ["nguoi-la", "member1"],
    ] as const) {
      await expect(
        changeRole(t.db, {
          actorId,
          workspaceId: ws,
          targetUserId,
          newRole: "owner",
        }),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    expect(await roleOf("member1")).toBe("member");
    expect(await roleOf("admin1")).toBe("admin");
  });

  it("không hạ vai trò owner cuối cùng, kể cả tự hạ mình", async () => {
    await expect(
      changeRole(t.db, {
        actorId: "owner1",
        workspaceId: ws,
        targetUserId: "owner1",
        newRole: "member",
      }),
    ).rejects.toMatchObject({ code: "conflict", reason: "last_owner" });
    expect(await roleOf("owner1")).toBe("owner");
  });

  it("có hai owner thì hạ được một người", async () => {
    await changeRole(t.db, {
      actorId: "owner1",
      workspaceId: ws,
      targetUserId: "admin1",
      newRole: "owner",
    });
    await changeRole(t.db, {
      actorId: "owner1",
      workspaceId: ws,
      targetUserId: "admin1",
      newRole: "member",
    });
    expect(await roleOf("admin1")).toBe("member");
  });

  it("đổi người không phải thành viên → not_found; đổi sang cùng vai trò là no-op", async () => {
    await expect(
      changeRole(t.db, {
        actorId: "owner1",
        workspaceId: ws,
        targetUserId: "nguoi-la",
        newRole: "member",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await changeRole(t.db, {
      actorId: "owner1",
      workspaceId: ws,
      targetUserId: "member1",
      newRole: "member",
    });
    expect(await roleOf("member1")).toBe("member");
  });

  it("hai owner cùng hạ nhau cùng lúc: luôn còn ít nhất một owner", async () => {
    await changeRole(t.db, {
      actorId: "owner1",
      workspaceId: ws,
      targetUserId: "admin1",
      newRole: "owner",
    });
    const results = await Promise.allSettled([
      changeRole(t.db, {
        actorId: "owner1",
        workspaceId: ws,
        targetUserId: "admin1",
        newRole: "member",
      }),
      changeRole(t.db, {
        actorId: "admin1",
        workspaceId: ws,
        targetUserId: "owner1",
        newRole: "member",
      }),
    ]);
    const owners = await t.db
      .select()
      .from(members)
      .where(and(eq(members.workspaceId, ws), eq(members.role, "owner")));
    expect(owners).toHaveLength(1);
    // đúng một lệnh thành công, lệnh kia bị từ chối (không phải cả hai cùng thành công)
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  // PGlite chạy transaction tuần tự nên không tái hiện được race thật; hàng rào ở đây là: MỌI thao tác
  // đổi thành viên phải khoá dòng workspace TRƯỚC khi đọc/ghi `members` (review 🟠 5). Bỏ `.for(...)`
  // thì test này đỏ.
  describe("khoá dòng workspace trước khi đổi thành viên", () => {
    const lockIdx = (qs: string[]) =>
      qs.findIndex((q) => /from "workspaces"[\s\S]*for no key update/i.test(q));
    const firstMemberIdx = (qs: string[]) =>
      qs.findIndex((q) => /"members"/.test(q));

    it.each([
      [
        "addMember",
        (d: typeof t.db) =>
          addMember(d, {
            actorId: "owner1",
            workspaceId: ws,
            userId: "u9",
            role: "member",
          }),
      ],
      [
        "changeRole",
        (d: typeof t.db) =>
          changeRole(d, {
            actorId: "owner1",
            workspaceId: ws,
            targetUserId: "member1",
            newRole: "admin",
          }),
      ],
      [
        "removeMember",
        (d: typeof t.db) =>
          removeMember(d, {
            actorId: "owner1",
            workspaceId: ws,
            targetUserId: "member1",
          }),
      ],
    ])("%s", async (_name, run) => {
      const queries: string[] = [];
      const t2 = await createTestDb(queries);
      await t2.db
        .insert(workspaces)
        .values({ id: ws, name: "Shop" })
        .onConflictDoNothing();
      await t2.db.insert(members).values([
        { workspaceId: ws, userId: "owner1", role: "owner" },
        { workspaceId: ws, userId: "member1", role: "member" },
      ]);
      queries.length = 0;
      await run(t2.db);
      await t2.client.close();
      expect(lockIdx(queries)).toBeGreaterThanOrEqual(0);
      expect(lockIdx(queries)).toBeLessThan(firstMemberIdx(queries));
    });
  });
});

describe("removeMember: không lộ ai là thành viên (review 🟡 8)", () => {
  it("member thường xoá người không tồn tại và người có thật đều nhận Forbidden như nhau", async () => {
    for (const targetUserId of ["nguoi-la", "admin1"]) {
      await expect(
        removeMember(t.db, {
          actorId: "member1",
          workspaceId: ws,
          targetUserId,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("removeMember", () => {
  it("owner xoá được member và admin; admin xoá được member", async () => {
    await removeMember(t.db, {
      actorId: "admin1",
      workspaceId: ws,
      targetUserId: "member1",
    });
    expect(await roleOf("member1")).toBeNull();
    await removeMember(t.db, {
      actorId: "owner1",
      workspaceId: ws,
      targetUserId: "admin1",
    });
    expect(await roleOf("admin1")).toBeNull();
  });

  it("admin không xoá được admin khác hay owner", async () => {
    await t.db
      .insert(members)
      .values({ workspaceId: ws, userId: "admin2", role: "admin" });
    for (const targetUserId of ["admin2", "owner1"]) {
      await expect(
        removeMember(t.db, {
          actorId: "admin1",
          workspaceId: ws,
          targetUserId,
        }),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
  });

  it("member tự rời được nhưng không xoá được người khác", async () => {
    await expect(
      removeMember(t.db, {
        actorId: "member1",
        workspaceId: ws,
        targetUserId: "admin1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await removeMember(t.db, {
      actorId: "member1",
      workspaceId: ws,
      targetUserId: "member1",
    });
    expect(await roleOf("member1")).toBeNull();
  });

  it("owner cuối cùng không tự xoá mình; có owner khác thì được", async () => {
    await expect(
      removeMember(t.db, {
        actorId: "owner1",
        workspaceId: ws,
        targetUserId: "owner1",
      }),
    ).rejects.toMatchObject({ code: "conflict", reason: "last_owner" });
    await changeRole(t.db, {
      actorId: "owner1",
      workspaceId: ws,
      targetUserId: "admin1",
      newRole: "owner",
    });
    await removeMember(t.db, {
      actorId: "owner1",
      workspaceId: ws,
      targetUserId: "owner1",
    });
    expect(await roleOf("owner1")).toBeNull();
    expect(await roleOf("admin1")).toBe("owner");
  });

  it("xoá người không phải thành viên → not_found", async () => {
    await expect(
      removeMember(t.db, {
        actorId: "owner1",
        workspaceId: ws,
        targetUserId: "nguoi-la",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("người ngoài workspace không xoá được ai", async () => {
    await expect(
      removeMember(t.db, {
        actorId: "nguoi-la",
        workspaceId: ws,
        targetUserId: "member1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("cô lập giữa các workspace", () => {
  it("owner của workspace A không có quyền gì ở workspace B", async () => {
    const wsB = await newWorkspace("Shop B");
    await t.db
      .insert(members)
      .values({ workspaceId: wsB, userId: "bOwner", role: "owner" });
    await expect(
      changeRole(t.db, {
        actorId: "owner1",
        workspaceId: wsB,
        targetUserId: "bOwner",
        newRole: "member",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      addMember(t.db, {
        actorId: "owner1",
        workspaceId: wsB,
        userId: "x",
        role: "member",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await roleOf("bOwner", wsB)).toBe("owner");
  });
});
