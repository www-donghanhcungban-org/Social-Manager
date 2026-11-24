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
let remote: ReturnType<typeof vi.fn>;
let credsSeen: string[];

function stubProvider(): SocialProvider {
  return {
    id: "stub",
    label: "Stub",
    support: { facebook: ["publish"] },
    publishPost: publish as unknown as SocialProvider["publishPost"],
    getPostStatus: remote as unknown as SocialProvider["getPostStatus"],
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
  remote = vi.fn(async () => ({ status: "published" as const }));
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
  it("đăng ngay: tạo bài scheduled với giờ = bây giờ [F-004/AC-01]", async () => {
    const p = await make().schedule(input());
    expect(p).toMatchObject({ status: "scheduled", text: "Xin chào" });
    expect(p.scheduledAt.toISOString()).toBe(NOW.toISOString());
  });

  it("hẹn giờ: lưu đúng thời điểm UTC kể cả khi nhập có offset [F-004/AC-01]", async () => {
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
  ])("từ chối giờ hẹn %s [F-004/AC-02]", async (_n, scheduledAt) => {
    await expect(
      make().schedule(input({ scheduledAt })),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await t.db.select().from(posts)).toHaveLength(0);
  });

  it("từ chối nội dung rỗng/khoảng trắng và khoá idempotency rỗng hoặc quá dài [F-004/AC-03]", async () => {
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

  it("chuẩn hoá nội dung NFC [F-004/AC-01]", async () => {
    const p = await make().schedule(input({ text: "Café" }));
    expect(p.text).toBe("Café");
  });

  it("người ngoài workspace bị Forbidden; tài khoản của workspace khác là NotFound [F-004/AC-09]", async () => {
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

  it("gửi lại cùng khoá idempotency trả đúng bài cũ, không tạo bài thứ hai [F-004/AC-04]", async () => {
    const a = await make().schedule(input());
    const b = await make().schedule(input());
    expect(b.id).toBe(a.id);
    expect(await t.db.select().from(posts)).toHaveLength(1);
  });

  it("cùng khoá nhưng nội dung khác là xung đột, không ghi đè [F-004/AC-04]", async () => {
    await make().schedule(input());
    await expect(
      make().schedule(input({ text: "Nội dung khác" })),
    ).rejects.toMatchObject({ reason: "idempotency_conflict" });
    await expect(
      make().schedule(input({ text: "Nội dung khác" })),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("hai yêu cầu song song cùng khoá chỉ tạo một bài [F-004/AC-04]", async () => {
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
  it("đăng bài đến hạn bằng đúng khoá đã giải mã, ghi published + external id [F-004/AC-05]", async () => {
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

  it("không đăng bài chưa đến hạn; bài đến hạn đúng ranh giới thì đăng [F-004/AC-05]", async () => {
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

  it("chạy hai lần không đăng trùng [F-004/AC-05]", async () => {
    await make().schedule(input());
    await make().runDue({ limit: 10 });
    await make().runDue({ limit: 10 });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("hai worker chạy song song không đăng trùng cùng một bài [F-004/AC-05]", async () => {
    await make().schedule(input());
    await Promise.all([
      make().runDue({ limit: 10 }),
      make().runDue({ limit: 10 }),
    ]);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("tôn trọng limit và đăng theo thứ tự giờ hẹn [F-004/AC-05]", async () => {
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

  it("lỗi từ nhà cung cấp: đánh dấu failed với mã ngắn, KHÔNG lộ nội dung lỗi, không tự đăng lại [F-004/AC-06]", async () => {
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

  it("lỗi không biết thành mã `internal`; một bài hỏng không chặn bài khác [F-004/AC-06]", async () => {
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

  it("nhà cung cấp trả submitted hoặc scheduled: bài ở submitted, chưa có publishedAt [F-004/AC-06]", async () => {
    for (const [i, status] of (["submitted", "scheduled"] as const).entries()) {
      publish.mockResolvedValueOnce({ id: `x${i}`, status });
      await make().schedule(
        input({ idempotencyKey: `k-${status}`, text: status }),
      );
    }
    await make().runDue({ limit: 10 });
    const rows = await t.db.select().from(posts);
    for (const row of rows) {
      expect(row.status).toBe("submitted");
      expect(row.publishedAt).toBeNull();
      expect(row.externalId).toMatch(/^x/);
    }
  });

  it.each([
    ["client.timeout", 0],
    ["client.network", 0],
    ["http.502", 502],
    ["client.invalid_response", 200],
  ])(
    "lỗi %s (có thể đã gửi) → send_unknown, không phải failed [F-004/AC-06]",
    async (code, status) => {
      publish.mockRejectedValueOnce(new SocialApiError("x", status, code));
      await make().schedule(input());
      await make().runDue({ limit: 10 });
      const [row] = await t.db.select().from(posts);
      expect(row).toMatchObject({ status: "send_unknown", errorCode: code });
    },
  );

  it("lỗi 4xx (chắc chắn bị từ chối) vẫn là failed [F-004/AC-06]", async () => {
    publish.mockRejectedValueOnce(new SocialApiError("x", 422, "http.422"));
    await make().schedule(input());
    await make().runDue({ limit: 10 });
    const [row] = await t.db.select().from(posts);
    expect(row).toMatchObject({ status: "failed", errorCode: "http.422" });
  });

  it("provider không còn đăng ký → failed `provider_unavailable`, không ném [F-004/AC-06]", async () => {
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
  it("bài kẹt `publishing` quá hạn chuyển send_unknown `interrupted` (có thể đã lên mạng; không tự đăng lại) [F-004/AC-07]", async () => {
    await make().schedule(input());
    await t.db
      .update(posts)
      .set({ status: "publishing", attempts: 1, claimedAt: NOW });
    const later = new Date(NOW.getTime() + 20 * 60_000);
    // chưa đủ lâu thì giữ nguyên
    expect(await make(NOW).recoverStuck({ olderThanMs: 600_000 })).toBe(0);
    expect(await make(later).recoverStuck({ olderThanMs: 600_000 })).toBe(1);
    const [row] = await t.db.select().from(posts).where(eq(posts.attempts, 1));
    expect(row).toMatchObject({
      status: "send_unknown",
      errorCode: "interrupted",
    });
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("confirmSubmitted", () => {
  const DAY = 86_400_000;
  async function submitted(text = "Xin chào", claimedAt = NOW) {
    publish.mockResolvedValueOnce({ id: `ext-${text}`, status: "submitted" });
    await make().schedule(input({ text, idempotencyKey: text }));
    await make().runDue({ limit: 10 });
    await t.db.update(posts).set({ claimedAt }).where(eq(posts.text, text));
  }
  const confirm = (now = NOW) =>
    make(now).confirmSubmitted({ limit: 10, deadlineMs: DAY });
  const row = async () => (await t.db.select().from(posts))[0]!;

  it("nhà cung cấp xác nhận published → published kèm publishedAt; hỏi đúng id bài [F-004/AC-08]", async () => {
    await submitted();
    expect(await confirm()).toMatchObject({ published: 1 });
    expect(await row()).toMatchObject({ status: "published", errorCode: null });
    expect((await row()).publishedAt).toEqual(NOW);
    expect(remote.mock.calls[0]![0]).toMatchObject({
      postId: "ext-Xin chào",
      accountId: "page1",
      platform: "facebook",
    });
  });

  it("partial → partial; failed → failed; cancelled → failed mã cancelled [F-004/AC-08]", async () => {
    await submitted();
    remote.mockResolvedValueOnce({ status: "partial" });
    await confirm();
    expect((await row()).status).toBe("partial");

    await t.db.delete(posts);
    await submitted("b");
    remote.mockResolvedValueOnce({ status: "failed" });
    await confirm();
    expect(await row()).toMatchObject({
      status: "failed",
      errorCode: "upstream_failed",
    });

    await t.db.delete(posts);
    await submitted("c");
    remote.mockResolvedValueOnce({ status: "cancelled" });
    await confirm();
    expect(await row()).toMatchObject({
      status: "failed",
      errorCode: "cancelled",
    });
  });

  it("còn pending hoặc lỗi mạng khi xác nhận: giữ submitted [F-004/AC-08]", async () => {
    await submitted();
    remote.mockResolvedValueOnce({ status: "pending" });
    expect(await confirm()).toMatchObject({ pending: 1 });
    remote.mockRejectedValueOnce(new SocialApiError("x", 0, "client.network"));
    expect(await confirm()).toMatchObject({ pending: 1 });
    expect((await row()).status).toBe("submitted");
  });

  it("trạng thái lạ từ provider không bị coi là thành công [F-004/AC-08]", async () => {
    await submitted();
    remote.mockResolvedValueOnce({ status: "teleported" });
    await confirm();
    expect((await row()).status).toBe("submitted");
  });

  it("quá hạn xác nhận mà chưa có kết quả cuối → send_unknown confirm_timeout, không đăng lại [F-004/AC-08]", async () => {
    await submitted();
    remote.mockResolvedValue({ status: "pending" });
    const later = new Date(NOW.getTime() + DAY + 1);
    expect(await confirm(later)).toMatchObject({ send_unknown: 1 });
    expect(await row()).toMatchObject({
      status: "send_unknown",
      errorCode: "confirm_timeout",
    });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("quá hạn nhưng lần hỏi cuối có kết quả thì theo kết quả đó", async () => {
    await submitted();
    const later = new Date(NOW.getTime() + DAY + 1);
    await confirm(later);
    expect((await row()).status).toBe("published");
  });

  it("provider không đọc lại được trạng thái: giữ submitted tới hạn rồi send_unknown", async () => {
    await submitted();
    const noRead = createPostService({
      db: t.db,
      box,
      now: () => new Date(NOW.getTime() + DAY + 1),
      resolveProvider: () => ({ ...stubProvider(), getPostStatus: undefined }),
    });
    await noRead.confirmSubmitted({ limit: 10, deadlineMs: DAY });
    expect((await row()).status).toBe("send_unknown");
  });

  it("không đụng bài ở trạng thái khác", async () => {
    await make().schedule(input());
    await make().runDue({ limit: 10 }); // published
    expect(await confirm()).toMatchObject({ published: 0, pending: 0 });
    expect(remote).not.toHaveBeenCalled();
  });
});

describe("list", () => {
  it("thành viên xem được bài của workspace, người ngoài bị Forbidden [F-004/AC-09]", async () => {
    await make().schedule(input());
    expect(
      await make().list({ actorId: "member", workspaceId: ws }),
    ).toHaveLength(1);
    await expect(
      make().list({ actorId: "outsider", workspaceId: ws }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
