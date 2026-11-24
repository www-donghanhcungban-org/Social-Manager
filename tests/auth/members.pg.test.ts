import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { changeRole, removeMember, type Db } from "@/src/auth/members";
import * as schema from "@/src/db/schema";
import { members, workspaces } from "@/src/db/schema";

import { MIGRATIONS } from "../db/helpers";

// Cần Postgres thật vì PGlite chạy transaction tuần tự, không tái hiện được race. Đặt
// TEST_DATABASE_URL để chạy; không đặt thì bỏ qua cục bộ. Ở CI, job `gate` cấp service Postgres và biến này
// (tests/config/ci-postgres.test.ts giữ điều đó), nên test không bị skip ngầm.
const ADMIN_URL = process.env.TEST_DATABASE_URL;
const d = ADMIN_URL ? describe : describe.skip;

d("khoá workspace trên Postgres thật (invariant: luôn còn ≥ 1 owner)", () => {
  const dbName = `sm_members_${randomBytes(4).toString("hex")}`;
  let pool: pg.Pool;
  let db: Db;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    await admin.end();
    const u = new URL(ADMIN_URL!);
    u.pathname = `/${dbName}`;
    pool = new pg.Pool({ connectionString: u.toString(), max: 10 });
    const real = drizzle(pool, { schema });
    await migrate(real, { migrationsFolder: MIGRATIONS });
    db = real as unknown as Db;
  });

  afterAll(async () => {
    await pool.end();
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  });

  async function freshWorkspace() {
    const [ws] = await db.insert(workspaces).values({ name: "W" }).returning();
    await db.insert(members).values([
      { workspaceId: ws!.id, userId: "o1", role: "owner" },
      { workspaceId: ws!.id, userId: "o2", role: "owner" },
    ]);
    return ws!.id;
  }

  const ownerCount = async (ws: string) =>
    (
      await db
        .select()
        .from(members)
        .where(and(eq(members.workspaceId, ws), eq(members.role, "owner")))
    ).length;

  it("hai owner cùng hạ nhau song song: sau 30 lượt luôn còn đúng 1 owner [F-001/AC-07]", async () => {
    for (let i = 0; i < 30; i++) {
      const ws = await freshWorkspace();
      const results = await Promise.allSettled([
        changeRole(db, {
          actorId: "o1",
          workspaceId: ws,
          targetUserId: "o2",
          newRole: "member",
        }),
        changeRole(db, {
          actorId: "o2",
          workspaceId: ws,
          targetUserId: "o1",
          newRole: "member",
        }),
      ]);
      expect(await ownerCount(ws), `lượt ${i}`).toBe(1);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    }
  });

  it("hai owner cùng tự rời song song: không bao giờ còn 0 owner [F-001/AC-07]", async () => {
    for (let i = 0; i < 30; i++) {
      const ws = await freshWorkspace();
      await Promise.allSettled([
        removeMember(db, {
          actorId: "o1",
          workspaceId: ws,
          targetUserId: "o1",
        }),
        removeMember(db, {
          actorId: "o2",
          workspaceId: ws,
          targetUserId: "o2",
        }),
      ]);
      expect(await ownerCount(ws), `lượt ${i}`).toBe(1);
    }
  });
});
