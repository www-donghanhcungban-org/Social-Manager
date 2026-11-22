import { readFileSync } from "node:fs";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  members,
  providerConnections,
  socialAccounts,
  workspaces,
} from "@/src/db/schema";

import { createTestDb, MIGRATIONS, readDownSql, tableNames } from "./helpers";

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

  const BUSINESS = [
    "members",
    "provider_connections",
    "social_accounts",
    "workspaces",
  ];
  const AUTH = ["account", "session", "user", "verification"];
  const journalRows = async () =>
    Number(
      (
        await t.client.query<{ n: string }>(
          "select count(*) n from drizzle.__drizzle_migrations",
        )
      ).rows[0]!.n,
    );

  const TAGS = (
    JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as {
      entries: { tag: string }[];
    }
  ).entries.map((e) => e.tag);
  const ALL = [
    ...BUSINESS,
    ...AUTH,
    "posts",
    "inbox_items",
    "conversations",
    "messages",
    "evidence_blobs",
    "evidence_items",
    "projects",
    "project_aliases",
    "project_links",
    "source_checkpoints",
    "connector_cursors",
  ];

  // Với mỗi migration: lùi từ bản mới nhất xuống tới nó (đúng thứ tự), sổ drizzle phải khớp,
  // rồi migrator thật dựng lại đủ — down không xoá dòng sổ thì migrator bỏ qua và thiếu bảng.
  it.each(TAGS.map((tag, i) => [tag, i] as const))(
    "lùi tới %s rồi chạy migrator thật: dựng lại đủ bảng",
    async (_tag, index) => {
      for (const tag of TAGS.slice(index).reverse()) {
        await t.client.exec(readDownSql(tag));
      }
      expect(await journalRows()).toBe(index);
      await migrate(t.db, { migrationsFolder: MIGRATIONS });
      expect(await tableNames(t.client)).toEqual(expect.arrayContaining(ALL));
      expect(await journalRows()).toBe(TAGS.length);
    },
  );

  it("mọi migration có file down", () => {
    for (const tag of TAGS) expect(() => readDownSql(tag)).not.toThrow();
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
