import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  members,
  providerConnections,
  socialAccounts,
  workspaces,
} from "@/src/db/schema";

import { createTestDb, readDownSql, tableNames } from "./helpers";

// Mã lỗi SQLSTATE của Postgres: kiểm đúng NGUYÊN NHÂN bị từ chối, không chỉ "có lỗi".
const NOT_NULL_VIOLATION = "23502";
const FK_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.client.close();
});

async function seed() {
  const [ws] = await t.db
    .insert(workspaces)
    .values({ name: "Shop A" })
    .returning();
  const [conn] = await t.db
    .insert(providerConnections)
    .values({
      workspaceId: ws!.id,
      provider: "socialapi",
      label: "chính",
      credentialsEnc: "v1:xxx",
    })
    .returning();
  return { ws: ws!, conn: conn! };
}

const count = async (table: string) =>
  Number(
    (await t.client.query<{ n: string }>(`select count(*) n from ${table}`))
      .rows[0]!.n,
  );

describe("migration", () => {
  it("tạo đủ 4 bảng nghiệp vụ", async () => {
    expect(await tableNames(t.client)).toEqual(
      expect.arrayContaining([
        "members",
        "provider_connections",
        "social_accounts",
        "workspaces",
      ]),
    );
  });

  it("có đường lùi: chạy down xoá hết bảng, rồi chạy lại up được", async () => {
    await t.client.exec(readDownSql("0000_init"));
    const left = await tableNames(t.client);
    for (const n of [
      "members",
      "provider_connections",
      "social_accounts",
      "workspaces",
    ]) {
      expect(left).not.toContain(n);
    }
    // up lần hai bằng SQL gốc (migrator đã ghi sổ nên chạy lại file SQL trực tiếp)
    const { readFileSync } = await import("node:fs");
    const { MIGRATIONS } = await import("./helpers");
    await t.client.exec(
      readFileSync(`${MIGRATIONS}/0000_init.sql`, "utf8").replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
    expect(await tableNames(t.client)).toContain("workspaces");
  });
});

describe("members", () => {
  it("nhận 3 vai trò hợp lệ", async () => {
    const { ws } = await seed();
    for (const [i, role] of (["owner", "admin", "member"] as const).entries()) {
      await t.db
        .insert(members)
        .values({ workspaceId: ws.id, userId: `u${i}`, role });
    }
    expect(await count("members")).toBe(3);
  });

  it("từ chối vai trò ngoài danh sách", async () => {
    const { ws } = await seed();
    await expect(
      t.db.insert(members).values({
        workspaceId: ws.id,
        userId: "u1",
        role: "superuser" as never,
      }),
    ).rejects.toMatchObject({ cause: { code: CHECK_VIOLATION } });
  });

  it("từ chối cùng một người vào cùng workspace hai lần", async () => {
    const { ws } = await seed();
    await t.db
      .insert(members)
      .values({ workspaceId: ws.id, userId: "u1", role: "member" });
    await expect(
      t.db
        .insert(members)
        .values({ workspaceId: ws.id, userId: "u1", role: "admin" }),
    ).rejects.toMatchObject({ cause: { code: UNIQUE_VIOLATION } });
  });

  it("từ chối thành viên của workspace không tồn tại", async () => {
    await expect(
      t.db.insert(members).values({
        workspaceId: "00000000-0000-0000-0000-000000000000",
        userId: "u1",
        role: "member",
      }),
    ).rejects.toMatchObject({ cause: { code: FK_VIOLATION } });
  });
});

describe("provider_connections và social_accounts", () => {
  it("bắt buộc có credentials đã mã hoá", async () => {
    const { ws } = await seed();
    await expect(
      t.db.insert(providerConnections).values({
        workspaceId: ws.id,
        provider: "socialapi",
        label: "x",
        credentialsEnc: null as never,
      }),
    ).rejects.toMatchObject({ cause: { code: NOT_NULL_VIOLATION } });
  });

  it("từ chối trùng (kết nối, nền tảng, id ngoài); khác nền tảng thì được", async () => {
    const { conn } = await seed();
    const acc = {
      connectionId: conn.id,
      platform: "facebook",
      externalId: "123",
      displayName: "Trang A",
    };
    await t.db.insert(socialAccounts).values(acc);
    await expect(t.db.insert(socialAccounts).values(acc)).rejects.toMatchObject(
      {
        cause: { code: UNIQUE_VIOLATION },
      },
    );
    await t.db.insert(socialAccounts).values({ ...acc, platform: "instagram" });
    expect(await count("social_accounts")).toBe(2);
  });

  it("từ chối nền tảng ngoài danh sách đã biết", async () => {
    const { conn } = await seed();
    await expect(
      t.db.insert(socialAccounts).values({
        connectionId: conn.id,
        platform: "myspace",
        externalId: "1",
        displayName: "x",
      }),
    ).rejects.toMatchObject({ cause: { code: CHECK_VIOLATION } });
  });
});

describe("xoá theo tầng", () => {
  it("xoá workspace xoá luôn thành viên, kết nối và tài khoản", async () => {
    const { ws, conn } = await seed();
    await t.db
      .insert(members)
      .values({ workspaceId: ws.id, userId: "u1", role: "owner" });
    await t.db.insert(socialAccounts).values({
      connectionId: conn.id,
      platform: "facebook",
      externalId: "1",
      displayName: "A",
    });
    await t.db.delete(workspaces).where(eq(workspaces.id, ws.id));
    for (const table of [
      "members",
      "provider_connections",
      "social_accounts",
      "workspaces",
    ]) {
      expect(await count(table)).toBe(0);
    }
  });

  it("xoá workspace này không đụng dữ liệu workspace khác", async () => {
    const a = await seed();
    const [other] = await t.db
      .insert(workspaces)
      .values({ name: "Shop B" })
      .returning();
    await t.db
      .insert(members)
      .values({ workspaceId: other!.id, userId: "u9", role: "owner" });
    await t.db.delete(workspaces).where(eq(workspaces.id, a.ws.id));
    expect(await count("workspaces")).toBe(1);
    expect(await count("members")).toBe(1);
  });
});
