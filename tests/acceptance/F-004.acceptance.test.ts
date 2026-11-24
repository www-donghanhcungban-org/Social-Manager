/**
 * Nghiệm thu F-004 — Đăng bài ngay và hẹn giờ (docs/specs/F-004-publish-posts.md).
 * Viết từ SPEC và chữ ký công khai của `createPostService`; chạy trên PGlite thật, nhà cung cấp là bản giả ở biên
 * (không mạng, không gửi tin thật).
 *
 * Không phủ bằng nghiệm thu tự động: (không có) — mọi AC của F-004 kiểm được qua dịch vụ; trang
 * `/app/<workspace>/posts` (mục 5 của SPEC) không thuộc AC nào nên không viết ở đây.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

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
  type PublishResult,
  type RemotePostStatus,
  type SocialProvider,
} from "@/src/providers/types";
import { createSecretBox } from "@/src/security/secret-box";

import { createTestDb } from "../db/helpers";

const T0 = new Date("2026-12-01T00:00:00.000Z");
const HOUR = 3_600_000;
const MIN = 60_000;
const box = createSecretBox(Buffer.alloc(32, 7).toString("base64"));
const rejectsWith = (p: Promise<unknown>, cls: new (...a: never[]) => Error) =>
  expect(p).rejects.toBeInstanceOf(cls);

type Db = Awaited<ReturnType<typeof createTestDb>>["db"];

let db: Db;
let W1: string;
let W2: string;
let acc1: string;
let acc1b: string;
let accOther: string;
let accBadCreds: string;
const USER = "user-member";
const STRANGER = "user-stranger";

const clock = { t: T0 };
const now = () => new Date(clock.t.getTime());

// --- nhà cung cấp giả ở biên -------------------------------------------------
const calls: PublishInput[] = [];
let onPublish: (i: PublishInput) => Promise<PublishResult> = async () => ({
  id: "ext-default",
  status: "published",
});
let onStatus: (
  postId: string,
) => Promise<{ status: RemotePostStatus }> = async () => ({
  status: "pending",
});
let providerAvailable = true;

const provider: SocialProvider = {
  id: "fake",
  label: "Fake",
  support: { facebook: ["publish"] },
  publishPost: async (i) => {
    calls.push(i);
    return onPublish(i);
  },
  getPostStatus: async (q) => onStatus(q.postId),
};

function makeService() {
  return createPostService({
    db,
    box,
    now,
    resolveProvider: () => (providerAvailable ? provider : undefined),
  });
}
let svc = makeService();

async function account(workspaceId: string, label: string, enc?: string) {
  const [c] = await db
    .insert(providerConnections)
    .values({
      workspaceId,
      provider: "fake",
      label,
      credentialsEnc: enc ?? box.encrypt("api-key"),
    })
    .returning();
  const [a] = await db
    .insert(socialAccounts)
    .values({
      connectionId: c!.id,
      platform: "facebook",
      externalId: `ext-${label}`,
      displayName: label,
    })
    .returning();
  return a!.id;
}

beforeAll(async () => {
  ({ db } = await createTestDb());
  const [w1, w2] = await db
    .insert(workspaces)
    .values([{ name: "W1" }, { name: "W2" }])
    .returning();
  W1 = w1!.id;
  W2 = w2!.id;
  await db.insert(members).values([
    { workspaceId: W1, userId: USER, role: "member" },
    { workspaceId: W2, userId: "user-w2", role: "owner" },
  ]);
  acc1 = await account(W1, "a1");
  acc1b = await account(W1, "a1b");
  accOther = await account(W2, "other");
  accBadCreds = await account(W1, "bad", "v1:khong-giai-ma-duoc");
});

beforeEach(async () => {
  await db.delete(posts);
  clock.t = T0;
  calls.length = 0;
  providerAvailable = true;
  onPublish = async () => ({ id: "ext-default", status: "published" });
  onStatus = async () => ({ status: "pending" });
  svc = makeService();
});

const schedule = (
  over: Partial<Parameters<typeof svc.schedule>[0]> & { key?: string } = {},
) =>
  svc.schedule({
    actorId: USER,
    workspaceId: W1,
    accountId: acc1,
    text: "Xin chào",
    idempotencyKey: over.key ?? crypto.randomUUID(),
    ...over,
  });

const rowOf = async (id: string) =>
  (await db.select().from(posts).where(eq(posts.id, id)))[0]!;
const countPosts = async () => (await db.select().from(posts)).length;

async function insertRaw(
  status: "publishing" | "submitted",
  claimedAt: Date,
  externalId: string | null = null,
) {
  const [r] = await db
    .insert(posts)
    .values({
      workspaceId: W1,
      socialAccountId: acc1,
      createdBy: USER,
      text: "bài kẹt",
      status,
      scheduledAt: new Date(claimedAt.getTime() - MIN),
      claimedAt,
      externalId,
      attempts: 1,
      idempotencyKey: crypto.randomUUID(),
    })
    .returning();
  return r!;
}

describe("F-004 Đăng bài ngay và hẹn giờ", () => {
  it("F-004/AC-01: đăng ngay tạo bài scheduled với scheduled_at = bây giờ", async () => {
    const p = await schedule();
    expect(p.status).toBe("scheduled");
    expect(p.scheduledAt.toISOString()).toBe(T0.toISOString());
    const row = await rowOf(p.id);
    expect(row.status).toBe("scheduled");
    expect(row.scheduledAt.toISOString()).toBe(T0.toISOString());
  });

  it("F-004/AC-01: hẹn giờ có offset được lưu đúng thời điểm UTC", async () => {
    const p = await schedule({ scheduledAt: "2026-12-05T10:00:00+07:00" });
    expect(p.status).toBe("scheduled");
    expect(p.scheduledAt.toISOString()).toBe("2026-12-05T03:00:00.000Z");
    expect((await rowOf(p.id)).scheduledAt.toISOString()).toBe(
      "2026-12-05T03:00:00.000Z",
    );
  });

  it("F-004/AC-01: nội dung được chuẩn hoá NFC", async () => {
    const p = await schedule({ text: "café" });
    expect(p.text).toBe("café");
    expect((await rowOf(p.id)).text).toBe("café");
  });

  it.each([
    ["đã qua", "2026-11-30T00:00:00Z"],
    ["đúng bằng hiện tại", "2026-12-01T00:00:00Z"],
    ["không phải ISO", "ngày mai"],
    ["thiếu múi giờ", "2026-12-05T10:00:00"],
    ["chỉ có ngày", "2026-12-05"],
    ["ngày không có thật", "2026-02-30T10:00:00Z"],
  ])("F-004/AC-02: giờ hẹn %s bị từ chối, không ghi bài", async (_n, at) => {
    await rejectsWith(schedule({ scheduledAt: at }), ValidationError);
    expect(await countPosts()).toBe(0);
  });

  it.each([
    ["rỗng", ""],
    ["chỉ khoảng trắng", "  \n\t "],
  ])("F-004/AC-03: nội dung %s bị từ chối", async (_n, text) => {
    await rejectsWith(schedule({ text }), ValidationError);
    expect(await countPosts()).toBe(0);
  });

  it("F-004/AC-03: khoá idempotency rỗng hoặc dài hơn 128 ký tự bị từ chối, đúng 128 được nhận", async () => {
    await rejectsWith(schedule({ key: "" }), ValidationError);
    await rejectsWith(schedule({ key: "k".repeat(129) }), ValidationError);
    expect(await countPosts()).toBe(0);
    const ok = await schedule({ key: "k".repeat(128) });
    expect(ok.status).toBe("scheduled");
    expect(await countPosts()).toBe(1);
  });

  it("F-004/AC-03: CSDL cũng từ chối nội dung chỉ khoảng trắng", async () => {
    await expect(
      db.insert(posts).values({
        workspaceId: W1,
        socialAccountId: acc1,
        createdBy: USER,
        text: "   ",
        status: "scheduled",
        scheduledAt: T0,
        idempotencyKey: "raw-empty",
      }),
    ).rejects.toThrow();
    expect(await countPosts()).toBe(0);
  });

  it("F-004/AC-04: gửi lại cùng khoá tuần tự trả đúng bài cũ", async () => {
    const a = await schedule({ key: "K1" });
    const b = await schedule({ key: "K1" });
    expect(b.id).toBe(a.id);
    expect(await countPosts()).toBe(1);
  });

  it("F-004/AC-04: hai yêu cầu song song cùng khoá chỉ tạo một bài", async () => {
    const [a, b] = await Promise.all([
      schedule({ key: "K2" }),
      schedule({ key: "K2" }),
    ]);
    expect(a.id).toBe(b.id);
    expect(await countPosts()).toBe(1);
  });

  it("F-004/AC-04: cùng khoá nhưng nội dung khác là idempotency_conflict, không ghi đè", async () => {
    const a = await schedule({ key: "K3", text: "bản đầu" });
    const err = await schedule({ key: "K3", text: "bản khác" }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).reason).toBe("idempotency_conflict");
    expect((await rowOf(a.id)).text).toBe("bản đầu");
    expect(await countPosts()).toBe(1);
  });

  it("F-004/AC-04: cùng khoá nhưng tài khoản khác là idempotency_conflict", async () => {
    const a = await schedule({ key: "K4", accountId: acc1 });
    const err = await schedule({ key: "K4", accountId: acc1b }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).reason).toBe("idempotency_conflict");
    expect((await rowOf(a.id)).socialAccountId).toBe(acc1);
    expect(await countPosts()).toBe(1);
  });

  it("F-004/AC-05: bài chưa đến hạn không bị đăng", async () => {
    await schedule({ scheduledAt: "2026-12-01T01:00:00Z" });
    await svc.runDue({ limit: 10 });
    expect(calls).toHaveLength(0);
    expect((await db.select().from(posts))[0]!.status).toBe("scheduled");
  });

  it("F-004/AC-05: đúng ranh giới giờ hẹn thì đăng, nhận bài chuyển publishing tăng attempts và gọi nhà cung cấp một lần", async () => {
    const p = await schedule({ scheduledAt: "2026-12-01T01:00:00Z" });
    clock.t = new Date(T0.getTime() + HOUR);
    let seenStatus = "";
    onPublish = async () => {
      seenStatus = (await rowOf(p.id)).status;
      return { id: "ext-1", status: "published" };
    };
    await svc.runDue({ limit: 10 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.text).toBe("Xin chào");
    expect(seenStatus).toBe("publishing");
    const row = await rowOf(p.id);
    expect(row.status).toBe("published");
    expect(row.attempts).toBe(1);
  });

  it("F-004/AC-05: chạy lại runDue không đăng lần hai", async () => {
    await schedule();
    await svc.runDue({ limit: 10 });
    await svc.runDue({ limit: 10 });
    await svc.runDue({ limit: 10 });
    expect(calls).toHaveLength(1);
  });

  it("F-004/AC-05: hai worker chạy song song vẫn chỉ gọi nhà cung cấp một lần", async () => {
    await schedule();
    const other = makeService();
    await Promise.all([svc.runDue({ limit: 10 }), other.runDue({ limit: 10 })]);
    expect(calls).toHaveLength(1);
    expect((await db.select().from(posts))[0]!.attempts).toBe(1);
  });

  it("F-004/AC-05: đăng theo thứ tự giờ hẹn và tôn trọng limit", async () => {
    await schedule({ text: "ba", scheduledAt: "2026-12-01T03:00:00Z" });
    await schedule({ text: "một", scheduledAt: "2026-12-01T01:00:00Z" });
    await schedule({ text: "hai", scheduledAt: "2026-12-01T02:00:00Z" });
    clock.t = new Date(T0.getTime() + 4 * HOUR);
    await svc.runDue({ limit: 2 });
    expect(calls.map((c) => c.text)).toEqual(["một", "hai"]);
    const left = await db
      .select()
      .from(posts)
      .where(eq(posts.status, "scheduled"));
    expect(left.map((r) => r.text)).toEqual(["ba"]);
  });

  describe("F-004/AC-06 trạng thái phản ánh đúng kết quả", () => {
    const runOne = async () => {
      const p = await schedule();
      await svc.runDue({ limit: 10 });
      return rowOf(p.id);
    };

    it("F-004/AC-06: nhà cung cấp báo published thì bài published kèm published_at", async () => {
      onPublish = async () => ({ id: "x1", status: "published" });
      const row = await runOne();
      expect(row.status).toBe("published");
      expect(row.publishedAt).not.toBeNull();
    });

    it.each(["submitted", "scheduled"] as const)(
      "F-004/AC-06: nhà cung cấp báo %s thì bài submitted chờ xác nhận, chưa có published_at",
      async (status) => {
        onPublish = async () => ({ id: "x2", status });
        const row = await runOne();
        expect(row.status).toBe("submitted");
        expect(row.publishedAt).toBeNull();
      },
    );

    it("F-004/AC-06: lỗi 4xx là failed, mã ngắn không chứa nội dung lỗi", async () => {
      onPublish = async () => {
        throw new SocialApiError(
          "SECRET-BODY nội dung nhạy cảm",
          400,
          "http.400",
        );
      };
      const row = await runOne();
      expect(row.status).toBe("failed");
      expect(row.errorCode).toMatch(/^[a-z0-9_.-]{1,64}$/i);
      expect(row.errorCode).not.toContain("SECRET");
    });

    it("F-004/AC-06: mã lỗi lạ từ nhà cung cấp không bị lưu nguyên văn", async () => {
      onPublish = async () => {
        throw new SocialApiError("m", 422, "Nội dung lỗi: SECRET <b>x</b>");
      };
      const row = await runOne();
      expect(row.status).toBe("failed");
      expect(row.errorCode).toMatch(/^[a-z0-9_.-]{1,64}$/i);
    });

    it("F-004/AC-06: lỗi không xác định là failed với mã an toàn", async () => {
      onPublish = async () => {
        throw new Error("SECRET-DETAIL");
      };
      const row = await runOne();
      expect(row.status).toBe("failed");
      expect(row.errorCode).toMatch(/^[a-z0-9_.-]{1,64}$/i);
      expect(row.errorCode).not.toContain("SECRET");
    });

    it.each([
      ["hết giờ", 0, "client.timeout"],
      ["đứt mạng", 0, "client.network"],
      ["5xx", 503, "http.503"],
      ["2xx đọc không được", 200, "client.invalid_response"],
    ])(
      "F-004/AC-06: %s thì send_unknown và không tự đăng lại",
      async (_n, status, code) => {
        onPublish = async () => {
          throw new SocialApiError("SECRET-BODY", status, code);
        };
        const row = await runOne();
        expect(row.status).toBe("send_unknown");
        expect(row.errorCode ?? "").not.toContain("SECRET");
        await svc.runDue({ limit: 10 });
        await svc.runDue({ limit: 10 });
        expect(calls).toHaveLength(1);
        expect((await rowOf(row.id)).status).toBe("send_unknown");
      },
    );

    it("F-004/AC-06: provider không còn đăng ký thì failed provider_unavailable, không gọi ra ngoài", async () => {
      providerAvailable = false;
      const row = await runOne();
      expect(row.status).toBe("failed");
      expect(row.errorCode).toBe("provider_unavailable");
      expect(calls).toHaveLength(0);
    });

    it("F-004/AC-06: khoá nhà cung cấp hỏng thì failed credentials_unreadable", async () => {
      const p = await schedule({ accountId: accBadCreds });
      await svc.runDue({ limit: 10 });
      const row = await rowOf(p.id);
      expect(row.status).toBe("failed");
      expect(row.errorCode).toBe("credentials_unreadable");
      expect(calls).toHaveLength(0);
    });

    it("F-004/AC-06: một bài hỏng không chặn bài khác", async () => {
      const bad = await schedule({
        text: "hỏng",
        scheduledAt: "2026-12-01T01:00:00Z",
      });
      const good = await schedule({
        text: "tốt",
        scheduledAt: "2026-12-01T02:00:00Z",
      });
      onPublish = async (i) => {
        if (i.text === "hỏng") throw new SocialApiError("x", 400, "http.400");
        return { id: "ok", status: "published" };
      };
      clock.t = new Date(T0.getTime() + 3 * HOUR);
      await svc.runDue({ limit: 10 });
      expect((await rowOf(bad.id)).status).toBe("failed");
      expect((await rowOf(good.id)).status).toBe("published");
    });
  });

  it("F-004/AC-07: bài kẹt publishing quá 15 phút thành send_unknown/interrupted, không gọi lại nhà cung cấp", async () => {
    const stuck = await insertRaw(
      "publishing",
      new Date(T0.getTime() - 16 * MIN),
    );
    const recent = await insertRaw(
      "publishing",
      new Date(T0.getTime() - 5 * MIN),
    );
    await svc.recoverStuck({ olderThanMs: 15 * MIN });
    const s = await rowOf(stuck.id);
    expect(s.status).toBe("send_unknown");
    expect(s.errorCode).toBe("interrupted");
    expect((await rowOf(recent.id)).status).toBe("publishing");
    expect(calls).toHaveLength(0);
    // chạy lại không đổi gì
    await svc.recoverStuck({ olderThanMs: 15 * MIN });
    expect((await rowOf(stuck.id)).status).toBe("send_unknown");
    expect(calls).toHaveLength(0);
  });

  describe("F-004/AC-08 xác nhận bài đã gửi", () => {
    const confirm = () =>
      svc.confirmSubmitted({ limit: 50, deadlineMs: 24 * HOUR });

    it.each(["published", "partial"] as const)(
      "F-004/AC-08: nhà cung cấp báo %s thì bài chuyển trạng thái đó kèm published_at",
      async (remote) => {
        const p = await insertRaw(
          "submitted",
          new Date(T0.getTime() - HOUR),
          "e1",
        );
        onStatus = async () => ({ status: remote });
        await confirm();
        const row = await rowOf(p.id);
        expect(row.status).toBe(remote);
        expect(row.publishedAt).not.toBeNull();
      },
    );

    it.each(["failed", "cancelled"] as const)(
      "F-004/AC-08: nhà cung cấp báo %s thì bài failed",
      async (remote) => {
        const p = await insertRaw(
          "submitted",
          new Date(T0.getTime() - HOUR),
          "e2",
        );
        onStatus = async () => ({ status: remote });
        await confirm();
        expect((await rowOf(p.id)).status).toBe("failed");
      },
    );

    it("F-004/AC-08: còn pending, lỗi mạng hoặc trạng thái lạ thì giữ submitted", async () => {
      const a = await insertRaw(
        "submitted",
        new Date(T0.getTime() - HOUR),
        "p1",
      );
      const b = await insertRaw(
        "submitted",
        new Date(T0.getTime() - HOUR),
        "p2",
      );
      const c = await insertRaw(
        "submitted",
        new Date(T0.getTime() - HOUR),
        "p3",
      );
      onStatus = async (id) => {
        if (id === "p1") return { status: "pending" };
        if (id === "p2") throw new SocialApiError("down", 0, "client.network");
        return { status: "weird" as RemotePostStatus };
      };
      await confirm();
      for (const p of [a, b, c])
        expect((await rowOf(p.id)).status).toBe("submitted");
    });

    it("F-004/AC-08: dưới 24 giờ vẫn pending thì giữ submitted", async () => {
      const p = await insertRaw(
        "submitted",
        new Date(T0.getTime() - 23 * HOUR),
        "q1",
      );
      await confirm();
      expect((await rowOf(p.id)).status).toBe("submitted");
    });

    it("F-004/AC-08: quá 24 giờ chưa có kết quả cuối thì send_unknown/confirm_timeout, không đăng lại", async () => {
      const p = await insertRaw(
        "submitted",
        new Date(T0.getTime() - 25 * HOUR),
        "q2",
      );
      onStatus = async () => ({ status: "pending" });
      await confirm();
      const row = await rowOf(p.id);
      expect(row.status).toBe("send_unknown");
      expect(row.errorCode).toBe("confirm_timeout");
      expect(calls).toHaveLength(0);
    });
  });

  describe("F-004/AC-09 người ngoài và tài khoản lạ", () => {
    it("F-004/AC-09: người ngoài workspace xếp lịch bị Forbidden, không ghi bài", async () => {
      await rejectsWith(schedule({ actorId: STRANGER }), ForbiddenError);
      expect(await countPosts()).toBe(0);
    });

    it("F-004/AC-09: người ngoài xem danh sách bài bị Forbidden", async () => {
      await schedule();
      await expect(
        svc.list({ actorId: STRANGER, workspaceId: W1 }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("F-004/AC-09: tài khoản của workspace khác là NotFound, không ghi bài", async () => {
      await rejectsWith(schedule({ accountId: accOther }), NotFoundError);
      expect(await countPosts()).toBe(0);
    });

    it("F-004/AC-09: id tài khoản không phải UUID là NotFound", async () => {
      await rejectsWith(schedule({ accountId: "not-a-uuid" }), NotFoundError);
      expect(await countPosts()).toBe(0);
    });

    it("F-004/AC-09: thành viên xem được danh sách bài của workspace mình", async () => {
      const p = await schedule();
      const list = await svc.list({ actorId: USER, workspaceId: W1 });
      expect(list.map((x) => x.id)).toEqual([p.id]);
      const rows = await db
        .select()
        .from(posts)
        .where(and(eq(posts.workspaceId, W2)));
      expect(rows).toHaveLength(0);
    });
  });
});
