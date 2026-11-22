import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/src/auth/errors";
import {
  members,
  posts,
  providerConnections,
  socialAccounts,
  workspaces,
} from "@/src/db/schema";
import { createPostService } from "@/src/posts/service";
import { SocialApiError } from "@/src/providers/socialapi";
import {
  ValidationError,
  type PublishInput,
  type SocialProvider,
} from "@/src/providers/types";
import { createSecretBox } from "@/src/security/secret-box";

import { createTestDb } from "../db/helpers";

const NOW = new Date("2026-11-22T10:00:00.000Z");
const box = createSecretBox(randomBytes(32).toString("base64"));

let t: Awaited<ReturnType<typeof createTestDb>>;
let ws: string;
let account: string;
let foreignAccount: string;
let publish: ReturnType<typeof vi.fn>;
let credsSeen: string[];

function stubProvider(): SocialProvider {
  return {
    id: "stub",
    label: "Stub",
    support: { facebook: ["publish"] },
    publishPost: publish as unknown as SocialProvider["publishPost"],
  };
}

function make(now = NOW) {
  return createPostService({
    db: t.db,
    box,
    now: () => now,
    resolveProvider: (_id, credentials) => {
      credsSeen.push(credentials);
      return stubProvider();
    },
  });
}

async function seedAccount(workspaceId: string, external: string) {
  const [conn] = await t.db
    .insert(providerConnections)
    .values({
      workspaceId,
      provider: "stub",
      label: `c-${external}`,
      credentialsEnc: box.encrypt("KEY-" + external),
    })
    .returning();
  const [acc] = await t.db
    .insert(socialAccounts)
    .values({
      connectionId: conn!.id,
      platform: "facebook",
      externalId: external,
      displayName: external,
    })
    .returning();
  return acc!.id;
}

beforeEach(async () => {
  t = await createTestDb();
  credsSeen = [];
  publish = vi.fn(async (i: PublishInput) => ({
    id: `ext-${i.text}`,
    status: "published" as const,
  }));
  const [a] = await t.db.insert(workspaces).values({ name: "A" }).returning();
  const [b] = await t.db.insert(workspaces).values({ name: "B" }).returning();
  ws = a!.id;
  await t.db.insert(members).values([
    { workspaceId: ws, userId: "admin", role: "admin" },
    { workspaceId: ws, userId: "member", role: "member" },
    { workspaceId: b!.id, userId: "outsider", role: "owner" },
  ]);
  account = await seedAccount(ws, "page1");
  foreignAccount = await seedAccount(b!.id, "page2");
});
afterEach(async () => {
  await t.client.close();
});

const input = (over = {}) => ({
  actorId: "member",
  workspaceId: ws,
  accountId: account,
  text: "Xin chào",
  idempotencyKey: "k1",
  ...over,
});

describe("schedule", () => {
  it("đăng ngay: tạo bài scheduled với giờ = bây giờ", async () => {
    const p = await make().schedule(input());
    expect(p).toMatchObject({ status: "scheduled", text: "Xin chào" });
    expect(p.scheduledAt.toISOString()).toBe(NOW.toISOString());
  });

  it("hẹn giờ: lưu đúng thời điểm UTC kể cả khi nhập có offset", async () => {
    const p = await make().schedule(
      input({ scheduledAt: "2026-12-01T10:00:00+07:00" }),
    );
    expect(p.scheduledAt.toISOString()).toBe("2026-12-01T03:00:00.000Z");
  });

  it.each([
    ["đã qua", "2026-11-22T09:59:59Z"],
    ["đúng bằng hiện tại", "2026-11-22T10:00:00Z"],
    ["không phải ISO", "mai 8 giờ"],
    ["thiếu múi giờ", "2026-12-01T10:00"],
    ["ngày không có thật", "2027-02-30T10:00:00Z"],
  ])("từ chối giờ hẹn %s", async (_n, scheduledAt) => {
    await expect(
      make().schedule(input({ scheduledAt })),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await t.db.select().from(posts)).toHaveLength(0);
  });

  it("từ chối nội dung rỗng/khoảng trắng và khoá idempotency rỗng hoặc quá dài", async () => {
    for (const bad of [
      { text: "" },
      { text: "  \n " },
      { idempotencyKey: "" },
      { idempotencyKey: "x".repeat(129) },
    ]) {
      await expect(make().schedule(input(bad))).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
  });

  it("chuẩn hoá nội dung NFC", async () => {
    const p = await make().schedule(input({ text: "Café" }));
    expect(p.text).toBe("Café");
  });

  it("người ngoài workspace bị Forbidden; tài khoản của workspace khác là NotFound", async () => {
    await expect(
      make().schedule(input({ actorId: "outsider" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      make().schedule(input({ accountId: foreignAccount })),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      make().schedule(input({ accountId: "không-phải-uuid" })),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await t.db.select().from(posts)).toHaveLength(0);
  });

  it("gửi lại cùng khoá idempotency trả đúng bài cũ, không tạo bài thứ hai", async () => {
    const a = await make().schedule(input());
    const b = await make().schedule(input());
    expect(b.id).toBe(a.id);
    expect(await t.db.select().from(posts)).toHaveLength(1);
  });

  it("cùng khoá nhưng nội dung khác là xung đột, không ghi đè", async () => {
    await make().schedule(input());
    await expect(
      make().schedule(input({ text: "Nội dung khác" })),
    ).rejects.toMatchObject({ reason: "idempotency_conflict" });
    await expect(
      make().schedule(input({ text: "Nội dung khác" })),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("hai yêu cầu song song cùng khoá chỉ tạo một bài", async () => {
    const svc = make();
    const results = await Promise.allSettled([
      svc.schedule(input()),
      svc.schedule(input()),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await t.db.select().from(posts)).toHaveLength(1);
  });
});

describe("runDue", () => {
  it("đăng bài đến hạn bằng đúng khoá đã giải mã, ghi published + external id", async () => {
    await make().schedule(input());
    const r = await make().runDue({ limit: 10 });
    expect(r).toEqual({ published: 1, failed: 0 });
    expect(credsSeen).toEqual(["KEY-page1"]);
    const [row] = await t.db.select().from(posts);
    expect(row).toMatchObject({
      status: "published",
      externalId: "ext-Xin chào",
      attempts: 1,
      errorCode: null,
    });
    expect(row!.publishedAt?.toISOString()).toBe(NOW.toISOString());
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "facebook",
        accountId: "page1",
        text: "Xin chào",
      }),
    );
  });

  it("không đăng bài chưa đến hạn; bài đến hạn đúng ranh giới thì đăng", async () => {
    await make().schedule(input({ scheduledAt: "2026-11-22T10:00:01Z" }));
    expect(await make().runDue({ limit: 10 })).toEqual({
      published: 0,
      failed: 0,
    });
    expect(publish).not.toHaveBeenCalled();
    const later = new Date("2026-11-22T10:00:01.000Z");
    expect(await make(later).runDue({ limit: 10 })).toEqual({
      published: 1,
      failed: 0,
    });
  });

  it("chạy hai lần không đăng trùng", async () => {
    await make().schedule(input());
    await make().runDue({ limit: 10 });
    await make().runDue({ limit: 10 });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("hai worker chạy song song không đăng trùng cùng một bài", async () => {
    await make().schedule(input());
    await Promise.all([
      make().runDue({ limit: 10 }),
      make().runDue({ limit: 10 }),
    ]);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("tôn trọng limit và đăng theo thứ tự giờ hẹn", async () => {
    await make().schedule(
      input({
        idempotencyKey: "a",
        text: "A",
        scheduledAt: "2026-11-22T10:00:02Z",
      }),
    );
    await make().schedule(
      input({
        idempotencyKey: "b",
        text: "B",
        scheduledAt: "2026-11-22T10:00:01Z",
      }),
    );
    const later = new Date("2026-11-22T11:00:00Z");
    expect(await make(later).runDue({ limit: 1 })).toEqual({
      published: 1,
      failed: 0,
    });
    expect(publish.mock.calls[0]![0].text).toBe("B");
  });

  it("lỗi từ nhà cung cấp: đánh dấu failed với mã ngắn, KHÔNG lộ nội dung lỗi, không tự đăng lại", async () => {
    publish.mockRejectedValueOnce(
      new SocialApiError("token sk-live-abc hết hạn", 401, "http.401"),
    );
    await make().schedule(input());
    expect(await make().runDue({ limit: 10 })).toEqual({
      published: 0,
      failed: 1,
    });
    const [row] = await t.db.select().from(posts);
    expect(row).toMatchObject({ status: "failed", errorCode: "http.401" });
    expect(JSON.stringify(row)).not.toContain("sk-live");
    await make().runDue({ limit: 10 });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("lỗi không biết thành mã `internal`; một bài hỏng không chặn bài khác", async () => {
    publish
      .mockRejectedValueOnce(new Error("postgres://u:pw@h/db sập"))
      .mockResolvedValueOnce({ id: "ok", status: "published" });
    await make().schedule(input({ idempotencyKey: "a", text: "A" }));
    await make().schedule(input({ idempotencyKey: "b", text: "B" }));
    expect(await make().runDue({ limit: 10 })).toEqual({
      published: 1,
      failed: 1,
    });
    const rows = await t.db.select().from(posts);
    const failed = rows.find((r) => r.status === "failed");
    expect(failed?.errorCode).toBe("internal");
    expect(JSON.stringify(failed)).not.toContain("pw@");
  });

  it("nhà cung cấp trả scheduled (hẹn phía họ) vẫn tính đã đăng thành công", async () => {
    publish.mockResolvedValueOnce({ id: "x", status: "scheduled" });
    await make().schedule(input());
    await make().runDue({ limit: 10 });
    const [row] = await t.db.select().from(posts);
    expect(row!.status).toBe("published");
  });

  it("provider không còn đăng ký → failed `provider_unavailable`, không ném", async () => {
    const svc = createPostService({
      db: t.db,
      box,
      now: () => NOW,
      resolveProvider: () => undefined,
    });
    await svc.schedule(input());
    expect(await svc.runDue({ limit: 10 })).toEqual({
      published: 0,
      failed: 1,
    });
    const [row] = await t.db.select().from(posts);
    expect(row!.errorCode).toBe("provider_unavailable");
  });
});

describe("recoverStuck", () => {
  it("bài kẹt `publishing` quá hạn chuyển failed `interrupted` (không tự đăng lại để tránh trùng)", async () => {
    await make().schedule(input());
    await t.db
      .update(posts)
      .set({ status: "publishing", attempts: 1, claimedAt: NOW });
    const later = new Date(NOW.getTime() + 20 * 60_000);
    // chưa đủ lâu thì giữ nguyên
    expect(await make(NOW).recoverStuck({ olderThanMs: 600_000 })).toBe(0);
    expect(await make(later).recoverStuck({ olderThanMs: 600_000 })).toBe(1);
    const [row] = await t.db.select().from(posts).where(eq(posts.attempts, 1));
    expect(row).toMatchObject({ status: "failed", errorCode: "interrupted" });
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("list", () => {
  it("thành viên xem được bài của workspace, người ngoài bị Forbidden", async () => {
    await make().schedule(input());
    expect(
      await make().list({ actorId: "member", workspaceId: ws }),
    ).toHaveLength(1);
    await expect(
      make().list({ actorId: "outsider", workspaceId: ws }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
