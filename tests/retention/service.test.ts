import { randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  inboxItems,
  loginThrottle,
  members,
  providerConnections,
  session,
  socialAccounts,
  user,
  verification,
  workspaces,
} from "@/src/db/schema";
import { createRetentionService } from "@/src/retention/service";
import { createSecretBox } from "@/src/security/secret-box";

import { createTestDb } from "../db/helpers";

const box = createSecretBox(randomBytes(32).toString("base64"));
const NOW = new Date("2026-11-22T00:00:00.000Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

let t: Awaited<ReturnType<typeof createTestDb>>;
let ws: string;
let acc: string;
const svc = () => createRetentionService({ db: t.db });

async function seedItem(ext: string, receivedAt: Date) {
  await t.db.insert(inboxItems).values({
    workspaceId: ws,
    socialAccountId: acc,
    kind: "dm",
    externalId: ext,
    author: "Lan",
    text: "xin chào",
    receivedAt,
  });
}

beforeEach(async () => {
  t = await createTestDb();
  const [w] = await t.db.insert(workspaces).values({ name: "A" }).returning();
  ws = w!.id;
  await t.db
    .insert(members)
    .values({ workspaceId: ws, userId: "u1", role: "owner" });
  const [c] = await t.db
    .insert(providerConnections)
    .values({
      workspaceId: ws,
      provider: "demo",
      label: "c",
      credentialsEnc: box.encrypt("k"),
    })
    .returning();
  const [a] = await t.db
    .insert(socialAccounts)
    .values({
      connectionId: c!.id,
      platform: "facebook",
      externalId: "p",
      displayName: "P",
    })
    .returning();
  acc = a!.id;
});
afterEach(async () => {
  await t.client.close();
});

describe("tin hộp thư quá hạn lưu (365 ngày)", () => {
  it("xoá tin cũ hơn hạn, giữ tin còn trong hạn (kể cả sát ranh giới)", async () => {
    await seedItem("cu", ago(366));
    await seedItem("sat-hạn-trong", ago(364));
    await seedItem("moi", ago(1));
    const r = await svc().purgeExpired({ now: NOW });
    expect(r.inboxItems).toBe(1);
    const left = (await t.db.select().from(inboxItems)).map(
      (i) => i.externalId,
    );
    expect(left.sort()).toEqual(["moi", "sat-hạn-trong"]);
  });

  it("chạy lại lần hai không xoá thêm (lũy đẳng)", async () => {
    await seedItem("cu", ago(400));
    await svc().purgeExpired({ now: NOW });
    expect((await svc().purgeExpired({ now: NOW })).inboxItems).toBe(0);
  });

  it("mỗi lần chỉ xoá tối đa một lô, lô sau xoá tiếp (không khoá bảng lâu)", async () => {
    for (let i = 0; i < 5; i++) await seedItem(`cu${i}`, ago(500 + i));
    const r = await svc().purgeExpired({ now: NOW, batchSize: 2 });
    expect(r.inboxItems).toBe(2);
    expect(r.more).toBe(true);
    expect(await t.db.select().from(inboxItems)).toHaveLength(3);
  });

  it("hạn lưu cấu hình được và phải là số nguyên dương", async () => {
    await seedItem("a", ago(40));
    expect(
      (await svc().purgeExpired({ now: NOW, inboxDays: 30 })).inboxItems,
    ).toBe(1);
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      await expect(
        svc().purgeExpired({ now: NOW, inboxDays: bad }),
      ).rejects.toThrow(/inboxDays/);
    }
  });
});

describe("phiên và dữ liệu xác thực hết hạn", () => {
  async function seedUser() {
    await t.db.insert(user).values({
      id: "u1",
      name: "Lan",
      email: "lan@example.com",
      emailVerified: false,
    });
  }

  it("xoá phiên đã hết hạn quá 1 ngày, giữ phiên còn hạn và phiên vừa hết", async () => {
    await seedUser();
    const base = {
      userId: "u1",
      createdAt: ago(10),
      updatedAt: ago(10),
    };
    await t.db.insert(session).values([
      { id: "s-cu", token: "t1", expiresAt: ago(3), ...base },
      {
        id: "s-vua-het",
        token: "t2",
        expiresAt: new Date(NOW.getTime() - 3600_000),
        ...base,
      },
      {
        id: "s-con",
        token: "t3",
        expiresAt: new Date(NOW.getTime() + DAY),
        ...base,
      },
    ]);
    const r = await svc().purgeExpired({ now: NOW });
    expect(r.sessions).toBe(1);
    expect((await t.db.select().from(session)).map((s) => s.id).sort()).toEqual(
      ["s-con", "s-vua-het"],
    );
  });

  it("xoá mã xác minh hết hạn và bộ đếm đăng nhập cũ hơn 24 giờ", async () => {
    await t.db.insert(verification).values([
      { id: "v1", identifier: "a", value: "x", expiresAt: ago(3) },
      {
        id: "v2",
        identifier: "b",
        value: "y",
        expiresAt: new Date(NOW.getTime() + DAY),
      },
    ]);
    await t.db.insert(loginThrottle).values([
      { keyHash: "cu", failures: 9, updatedAt: ago(2) },
      {
        keyHash: "moi",
        failures: 3,
        updatedAt: new Date(NOW.getTime() - 3600_000),
      },
    ]);
    const r = await svc().purgeExpired({ now: NOW });
    expect(r.verifications).toBe(1);
    expect(r.loginThrottle).toBe(1);
    expect(
      (await t.db.select().from(loginThrottle)).map((x) => x.keyHash),
    ).toEqual(["moi"]);
  });
});
