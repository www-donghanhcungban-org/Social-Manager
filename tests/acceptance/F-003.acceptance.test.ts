/**
 * Nghiệm thu F-003 — Hộp thư hợp nhất.
 * Viết từ docs/specs/F-003-unified-inbox.md và hợp đồng công khai (docs/API-CONTRACT.md §7, docs/openapi.yaml,
 * chữ ký hàm xuất của dịch vụ hộp thư, nhập webhook và bộ chạy job). Chạy trên PGlite thật qua tests/db/helpers;
 * nhà cung cấp là provider giả/demo tiêm vào, hàng đợi là cổng `JobQueue` giả (không pg-boss), không mạng.
 *
 * Không phủ bằng nghiệm thu tự động:
 * - AC-01 (phần "thành viên bấm nút Đồng bộ" trên trang `/app/<ws>/inbox`): nút và Server Action chỉ kiểm được qua
 *   trình duyệt (e2e `inbox.spec.ts`); hàm dịch vụ mà nút gọi (`sync`) và đường job nền (`syncAsSystem`) được phủ.
 * - AC-04 (phần tham số lọc/cursor bậy trên URL không gây lỗi trang): hành vi của trang render, kiểm bằng e2e; ở tầng
 *   dịch vụ chỉ khẳng định cursor hỏng là ValidationError.
 * - AC-06 (phần e2e `webhook.spec.ts` qua HTTP thật và tiêu đề `x-socialapi-*`): route handler cần container Next.js;
 *   nghiệm thu gọi thẳng bộ nhập webhook mà route uỷ quyền, với cùng chữ ký HMAC-SHA256 của hợp đồng.
 * - AC-03 (phần pg-boss thật và `RUN_WORKERS=true`): cần Postgres + pg-boss; nghiệm thu dùng cổng `JobQueue` giả để
 *   kiểm lịch, singletonKey và payload.
 */
import { createHmac, randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAccountService } from "@/src/accounts/service";
import { ForbiddenError, NotFoundError } from "@/src/auth/errors";
import { addMember } from "@/src/auth/members";
import { createConnectionService } from "@/src/connections/service";
import {
  conversations,
  inboxItems,
  messages,
  type InboxStatus,
} from "@/src/db/schema";
import { createInboxService } from "@/src/inbox/service";
import { createWebhookIngest } from "@/src/inbox/webhook";
import { createJobRunner, QUEUES, type JobQueue } from "@/src/jobs/runner";
import { createLogger } from "@/src/log/logger";
import { createDemoProvider } from "@/src/providers/demo";
import { createRegistry } from "@/src/providers/registry";
import {
  createSocialApiProvider,
  SocialApiError,
} from "@/src/providers/socialapi";
import {
  UnsupportedError,
  ValidationError,
  type InboxItem,
  type InboxKind,
  type SocialProvider,
} from "@/src/providers/types";
import { createSecretBox } from "@/src/security/secret-box";
import { createWorkspaceService } from "@/src/workspaces/service";

import { createTestDb } from "../db/helpers";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const NOW = new Date("2026-11-24T08:00:00.000Z");
const NOW_MS = NOW.getTime();
const CRED = "khoa-nha-cung-cap-12345";
const WH_SECRET = "webhook-secret-0123456789";
const MASTER_KEY = Buffer.alloc(32, 7).toString("base64");

let t: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.client.close();
});

const noNetwork = vi.fn<typeof fetch>(async () => {
  throw new Error("acceptance: không được gọi mạng");
});

const CAP = {
  dm: "dm",
  comment: "comments",
  review: "reviews",
  mention: "mentions",
} as const;

/** Provider giả chỉ khai các loại hộp thư có trong `kinds`; mỗi loại do một hàm quyết định kết quả/lỗi. */
function fake(
  kinds: Partial<Record<InboxKind, () => InboxItem[] | Promise<InboxItem[]>>>,
): SocialProvider {
  const present = Object.keys(kinds) as InboxKind[];
  return {
    id: "demo",
    label: "giả",
    support: { facebook: present.map((k) => CAP[k]) },
    async listInbox({ kind }) {
      return kinds[kind]!();
    },
  };
}

const item = (
  kind: InboxKind,
  id: string,
  at: Date = NOW,
  over: Partial<InboxItem> = {},
): InboxItem => ({
  id,
  platform: "facebook",
  kind,
  author: "Khách",
  text: "nội dung",
  receivedAt: at.toISOString(),
  ...over,
});

const ago = (minutes: number) => new Date(NOW_MS - minutes * 60_000);

async function world() {
  const box = createSecretBox(MASTER_KEY);
  const registry = createRegistry();
  const demo = createDemoProvider({ now: () => NOW });
  registry.register(demo);
  registry.register(createSocialApiProvider({ apiKey: "x", fetch: noNetwork }));

  const providers = new Map<string, SocialProvider>([["demo", demo]]);
  const seenCredentials: string[] = [];
  const resolveProvider = (id: string, credentials: string) => {
    seenCredentials.push(credentials);
    return providers.get(id);
  };

  const conns = createConnectionService({ db: t.db, box, registry });
  const accts = createAccountService({ db: t.db, registry });
  const inbox = createInboxService({ db: t.db, box, resolveProvider });
  const webhooks = createWebhookIngest({ db: t.db, box, now: () => NOW_MS });
  const ws = createWorkspaceService({ db: t.db });

  const A = await ws.create({ actorId: "own", name: "Cửa hàng A" });
  const B = await ws.create({ actorId: "own-b", name: "Cửa hàng B" });
  await addMember(t.db, {
    actorId: "own",
    workspaceId: A.id,
    userId: "mem",
    role: "member",
  });

  const mkConn = (
    actorId: string,
    workspaceId: string,
    provider: string,
    label: string,
  ) =>
    conns.create({
      actorId,
      workspaceId,
      provider,
      label,
      credentials: CRED,
    });
  const mkAcc = (
    actorId: string,
    workspaceId: string,
    connectionId: string,
    externalId: string,
  ) =>
    accts.add({
      actorId,
      workspaceId,
      connectionId,
      platform: "facebook",
      externalId,
      displayName: externalId,
    });

  const connDemo = await mkConn("own", A.id, "demo", "demo A");
  const accDemo = await mkAcc("own", A.id, connDemo.id, "fb-1");
  const connSa = await mkConn("own", A.id, "socialapi", "sa A");
  await conns.setWebhookSecret({
    actorId: "own",
    workspaceId: A.id,
    connectionId: connSa.id,
    secret: WH_SECRET,
  });
  const accSa = await mkAcc("own", A.id, connSa.id, "fb-page-1");
  const connDemoB = await mkConn("own-b", B.id, "demo", "demo B");
  const accB = await mkAcc("own-b", B.id, connDemoB.id, "fb-b");

  const listA = (over: Partial<Parameters<typeof inbox.list>[0]> = {}) =>
    inbox.list({ actorId: "own", workspaceId: A.id, ...over });

  /** Gửi webhook như SocialAPI: ký HMAC-SHA256 trên `<timestamp>.<thân thô>`. */
  const post = (
    connectionId: string,
    body: object | string | Buffer,
    o: {
      secret?: string;
      ts?: string;
      signature?: string | null;
      timestamp?: string | null;
      signedBody?: Buffer;
    } = {},
  ) => {
    const raw = Buffer.isBuffer(body)
      ? body
      : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    const ts = o.ts ?? String(Math.floor(NOW_MS / 1000));
    const sig =
      "sha256=" +
      createHmac("sha256", o.secret ?? WH_SECRET)
        .update(`${ts}.`)
        .update(o.signedBody ?? raw)
        .digest("hex");
    return webhooks.handle({
      connectionId,
      rawBody: raw,
      timestamp: o.timestamp === undefined ? ts : o.timestamp,
      signature: o.signature === undefined ? sig : o.signature,
    });
  };

  return {
    box,
    registry,
    providers,
    seenCredentials,
    conns,
    accts,
    inbox,
    webhooks,
    A,
    B,
    connDemo,
    accDemo,
    connSa,
    accSa,
    accB,
    listA,
    post,
  };
}
type World = Awaited<ReturnType<typeof world>>;

const count = async (
  table: typeof inboxItems | typeof messages | typeof conversations,
) => (await t.db.select().from(table)).length;

const commentEvent = (
  id: string,
  at: Date = NOW,
  text = "Giá bao nhiêu ạ?",
  accountId = "fb-page-1",
) => ({
  event: "comment.received",
  data: {
    account_id: accountId,
    id,
    received_at: at.toISOString(),
    author: { id: "u1", name: "An" },
    content: { text },
  },
});

const dmEvent = (
  id: string,
  platformId: string | null,
  at: Date,
  text = "xin chào",
) => ({
  event: "dm.received",
  data: {
    account_id: "fb-page-1",
    id,
    conversation_id: "conv-1",
    platform_id: platformId,
    received_at: at.toISOString(),
    author: { id: "u1", name: "An" },
    content: { text },
  },
});

const UNAUTHORIZED = { status: 401, body: { status: "unauthorized" } };

describe("F-003 đồng bộ", () => {
  it("F-003/AC-01: đồng bộ giải mã khoá, hỏi mọi loại hộp thư được hỗ trợ, nhập mục mới (open, UTC) vào đúng workspace; DM đi đường hội thoại + tin nhắn", async () => {
    const w = await world();
    const res = await w.inbox.sync({
      actorId: "mem", // thành viên bấm Đồng bộ
      workspaceId: w.A.id,
      accountId: w.accDemo.id,
    });
    expect(res.inserted).toBe(4);
    expect(res.messages).toBe(2);
    expect(res.failed).toEqual([]);

    // khoá được giải mã trước khi tới provider, không phải bản mã
    expect(w.seenCredentials).toContain(CRED);
    expect(w.seenCredentials.every((c) => !c.startsWith("v1:"))).toBe(true);

    const { items } = await w.listA();
    expect(items.map((i) => i.kind).sort()).toEqual([
      "comment",
      "dm",
      "mention",
      "review",
    ]);
    expect(items.every((i) => i.status === "open")).toBe(true);
    expect(items.every((i) => i.handledBy === null)).toBe(true);
    expect(items.every((i) => i.socialAccountId === w.accDemo.id)).toBe(true);
    const comment = items.find((i) => i.kind === "comment")!;
    expect(comment.receivedAt.toISOString()).toBe(NOW.toISOString());

    // DM đi đường hội thoại: có hội thoại + 2 tin nhắn; mục DM khoá theo id hội thoại
    expect(await count(conversations)).toBe(1);
    expect(await count(messages)).toBe(2);
    const dm = items.find((i) => i.kind === "dm")!;
    const [conv] = await t.db.select().from(conversations);
    expect(dm.externalId).toBe(conv!.externalId);
    // workspace B không nhận gì
    const b = await w.inbox.list({ actorId: "own-b", workspaceId: w.B.id });
    expect(b.items).toHaveLength(0);
  });

  it("F-003/AC-01: job nền (không có người dùng) đồng bộ như nút Đồng bộ", async () => {
    const w = await world();
    const res = await w.inbox.syncAsSystem({
      workspaceId: w.A.id,
      accountId: w.accDemo.id,
    });
    expect(res.inserted).toBe(4);
    expect((await w.listA()).items).toHaveLength(4);
  });

  it("F-003/AC-01: nội dung rỗng nhập thành chuỗi rỗng, nội dung > 10.000 ký tự bị cắt, giờ có múi giờ lưu theo UTC", async () => {
    const w = await world();
    w.providers.set(
      "demo",
      fake({
        comment: () => [
          item("comment", "rong", NOW, { text: "" }),
          item("comment", "dai", NOW, { text: "x".repeat(12_000) }),
          {
            ...item("comment", "gio-vn"),
            receivedAt: "2026-11-24T15:00:00+07:00",
          },
        ],
      }),
    );
    await w.inbox.sync({
      actorId: "own",
      workspaceId: w.A.id,
      accountId: w.accDemo.id,
    });
    const byId = new Map(
      (await w.listA()).items.map((i) => [i.externalId, i] as const),
    );
    expect(byId.get("rong")?.text).toBe("");
    expect(byId.get("dai")?.text).toHaveLength(10_000);
    expect(byId.get("gio-vn")?.receivedAt.toISOString()).toBe(
      "2026-11-24T08:00:00.000Z",
    );
  });

  it("F-003/AC-02: đồng bộ lặp không tạo bản trùng và không ghi đè trạng thái đã xử lý", async () => {
    const w = await world();
    const sync = () =>
      w.inbox.sync({
        actorId: "own",
        workspaceId: w.A.id,
        accountId: w.accDemo.id,
      });
    await sync();
    const first = (await w.listA()).items;
    expect(first).toHaveLength(4);
    for (const it of first)
      await w.inbox.setStatus({
        actorId: "mem",
        workspaceId: w.A.id,
        itemId: it.id,
        status: "handled",
      });

    const again = await sync();
    expect(again.inserted).toBe(0);
    const after = (await w.listA()).items;
    expect(after).toHaveLength(4);
    expect(after.every((i) => i.status === "handled")).toBe(true);
    expect(after.every((i) => i.handledBy === "mem")).toBe(true);
    expect(await count(messages)).toBe(2);
    expect(await count(conversations)).toBe(1);
  });

  it("F-003/AC-02: hai lượt đồng bộ cùng tài khoản chạy cùng lúc vẫn không có bản trùng", async () => {
    const w = await world();
    const sync = () =>
      w.inbox.sync({
        actorId: "own",
        workspaceId: w.A.id,
        accountId: w.accDemo.id,
      });
    await Promise.all([sync(), sync()]);
    expect(await count(inboxItems)).toBe(4);
    expect(await count(messages)).toBe(2);
    expect(await count(conversations)).toBe(1);
  });

  it("F-003/AC-02: cùng id ở loại khác là hai mục", async () => {
    const w = await world();
    w.providers.set(
      "demo",
      fake({
        comment: () => [item("comment", "x1")],
        mention: () => [item("mention", "x1")],
      }),
    );
    await w.inbox.sync({
      actorId: "own",
      workspaceId: w.A.id,
      accountId: w.accDemo.id,
    });
    const { items } = await w.listA();
    expect(items.map((i) => i.kind).sort()).toEqual(["comment", "mention"]);
    expect(items.every((i) => i.externalId === "x1")).toBe(true);
  });

  it("F-003/AC-02: webhook rồi đồng bộ cùng một tin (và ngược lại) chỉ cho một mục, một tin", async () => {
    const w = await world();
    const T1 = ago(30);
    w.providers.set("socialapi", {
      id: "socialapi",
      label: "giả",
      support: { facebook: ["dm"] },
      async listConversations() {
        return {
          items: [
            {
              id: "conv-1",
              participantId: "u1",
              participantName: "An",
              lastMessageAt: T1.toISOString(),
            },
          ],
          nextCursor: null,
        };
      },
      async listMessages() {
        return {
          items: [
            {
              id: "p-1",
              identityWeak: false,
              providerMessageId: "m-1",
              direction: "incoming",
              author: "An",
              text: "xin chào",
              sentAt: T1.toISOString(),
            },
          ],
          nextCursor: null,
        };
      },
    });
    const hook = await w.post(w.connSa.id, dmEvent("m-1", "p-1", T1));
    expect(hook).toEqual({ status: 200, body: { status: "ok", inserted: 1 } });
    await w.inbox.sync({
      actorId: "own",
      workspaceId: w.A.id,
      accountId: w.accSa.id,
    });
    expect(await count(messages)).toBe(1);
    expect(await count(inboxItems)).toBe(1);
    // gửi lại webhook sau đồng bộ: vẫn một tin
    const replay = await w.post(w.connSa.id, dmEvent("m-1", "p-1", T1));
    expect(replay.body.inserted).toBe(0);
    expect(await count(messages)).toBe(1);
    expect(await count(inboxItems)).toBe(1);
  });

  it("F-003/AC-10: một loại hộp thư lỗi (mạng, 401, lỗi lạ) chỉ ghi mã an toàn, không lộ nội dung lỗi; loại khác vẫn nhập; lượt sau nhập tiếp", async () => {
    const w = await world();
    let commentOk = false;
    w.providers.set(
      "demo",
      fake({
        dm: () => {
          throw new Error("password=hunter2 kết nối DB hỏng");
        },
        comment: () => {
          if (commentOk) return [item("comment", "c-sau")];
          throw new SocialApiError("không kết nối được", 0, "client.network");
        },
        review: () => {
          throw new SocialApiError(
            "nội dung nhà cung cấp rò rỉ",
            401,
            "http.401",
          );
        },
        mention: () => [item("mention", "m-1")],
      }),
    );
    const sync = () =>
      w.inbox.sync({
        actorId: "own",
        workspaceId: w.A.id,
        accountId: w.accDemo.id,
      });
    const res = await sync();
    expect(res.inserted).toBe(1);
    const codes = new Map(res.failed.map((f) => [f.kind, f.code] as const));
    expect(codes.get("comment")).toBe("client.network");
    expect(codes.get("review")).toBe("http.401");
    expect(codes.get("dm")).toBe("internal");
    const dump = JSON.stringify(res);
    expect(dump).not.toContain("hunter2");
    expect(dump).not.toContain("rò rỉ");
    expect((await w.listA()).items.map((i) => i.externalId)).toEqual(["m-1"]);

    commentOk = true;
    const next = await sync();
    expect(next.inserted).toBe(1);
    expect(
      (await w.listA({ kind: "comment" })).items.map((i) => i.externalId),
    ).toEqual(["c-sau"]);
  });

  it("F-003/AC-10: loại chưa cài đặt vào skipped; mã lỗi lạ thành upstream_error; mục sai bị bỏ qua và đếm rejected", async () => {
    const w = await world();
    w.providers.set(
      "demo",
      fake({
        comment: () => {
          throw new UnsupportedError("facebook", "comments", "not_implemented");
        },
        mention: () => {
          throw new SocialApiError("x", 502, "Lỗi lạ có khoảng trắng!");
        },
        review: () => [
          item("review", "r-ok"),
          item("review", ""), // id rỗng
          item("review", "r-ngay", NOW, { receivedAt: "không phải ngày" }),
          item("review", "r-tz", NOW, { receivedAt: "2026-11-20T10:00:00" }), // thiếu múi giờ
          item("comment", "r-lech"), // loại lệch
        ],
      }),
    );
    const res = await w.inbox.sync({
      actorId: "own",
      workspaceId: w.A.id,
      accountId: w.accDemo.id,
    });
    expect(res.skipped).toContain("comment");
    expect(res.failed).toContainEqual({
      kind: "mention",
      code: "upstream_error",
    });
    expect(res.rejected).toBe(4);
    expect(res.inserted).toBe(1);
    expect((await w.listA()).items.map((i) => i.externalId)).toEqual(["r-ok"]);
  });
});

describe("F-003 hàng đợi nền", () => {
  function fakeQueue() {
    const handlers = new Map<string, (d: unknown) => Promise<void>>();
    const sent: {
      name: string;
      data: object;
      options?: { singletonKey?: string };
    }[] = [];
    const schedules: [string, string][] = [];
    const queue: JobQueue = {
      async createQueue() {},
      async schedule(name, cron) {
        schedules.push([name, cron]);
      },
      async work(name, handler) {
        handlers.set(name, handler);
      },
      async send(name, data, options) {
        sent.push({ name, data, options });
      },
    };
    return { queue, handlers, sent, schedules };
  }

  async function runner(w: World) {
    const q = fakeQueue();
    const syncSpy = vi.fn(w.inbox.syncAsSystem);
    const accounts = [
      { workspaceId: w.A.id, accountId: w.accDemo.id },
      { workspaceId: w.B.id, accountId: w.accB.id },
    ];
    const r = createJobRunner({
      queue: q.queue,
      posts: {
        runDue: async () => ({ published: 0, failed: 0 }),
        recoverStuck: async () => 0,
        confirmSubmitted: async () => ({}),
      },
      actions: {
        dispatchDue: async () => ({}),
        reconcileDue: async () => ({}),
        recoverStuck: async () => 0,
      },
      inbox: { syncAsSystem: syncSpy },
      retention: {
        purgeExpired: async () => ({
          inboxItems: 0,
          messages: 0,
          conversations: 0,
          evidenceBlobs: 0,
          sessions: 0,
          verifications: 0,
          loginThrottle: 0,
          more: false,
        }),
      },
      listAccounts: async () => accounts,
      log: createLogger({
        service: "acceptance",
        version: "0",
        env: "test",
        write: () => {},
      }),
    });
    await r.start();
    return { ...q, syncSpy, accounts };
  }

  it("F-003/AC-03: đồng bộ tất cả được lên lịch mỗi 5 phút", async () => {
    const w = await world();
    const r = await runner(w);
    expect(r.schedules).toContainEqual([QUEUES.syncAll, "*/5 * * * *"]);
  });

  it("F-003/AC-03: mỗi tài khoản thành một job riêng có singletonKey, payload chỉ có workspaceId + accountId", async () => {
    const w = await world();
    const r = await runner(w);
    await r.handlers.get(QUEUES.syncAll)!({});
    const jobs = r.sent.filter((s) => s.name === QUEUES.syncAccount);
    expect(jobs).toHaveLength(2);
    for (const a of r.accounts) {
      const job = jobs.find(
        (j) => (j.data as { accountId: string }).accountId === a.accountId,
      );
      expect(job).toBeDefined();
      expect(job!.data).toEqual({
        workspaceId: a.workspaceId,
        accountId: a.accountId,
      });
      expect(job!.options?.singletonKey).toBe(a.accountId);
    }
    expect(JSON.stringify(jobs)).not.toContain(CRED);
  });

  it("F-003/AC-03: job đồng bộ tài khoản với payload đúng thật sự nhập tin vào workspace", async () => {
    const w = await world();
    const r = await runner(w);
    await r.handlers.get(QUEUES.syncAccount)!({
      workspaceId: w.A.id,
      accountId: w.accDemo.id,
    });
    expect(r.syncSpy).toHaveBeenCalledTimes(1);
    expect((await w.listA()).items).toHaveLength(4);
  });

  it("F-003/AC-03: payload sai (thừa trường, thiếu trường, rỗng, không phải đối tượng) bị từ chối, không đồng bộ", async () => {
    const w = await world();
    const r = await runner(w);
    const handler = r.handlers.get(QUEUES.syncAccount)!;
    for (const bad of [
      {
        workspaceId: w.A.id,
        accountId: w.accDemo.id,
        credentials: "bí mật",
      },
      { workspaceId: w.A.id },
      { workspaceId: "", accountId: "" },
      null,
      "chuỗi",
      42,
    ])
      await handler(bad).catch(() => {});
    expect(r.syncSpy).not.toHaveBeenCalled();
    expect(await count(inboxItems)).toBe(0);
  });
});

describe("F-003 lọc, phân trang, đổi trạng thái", () => {
  /** Nạp mục theo kịch bản qua đồng bộ (đường chính thức), không chèn thẳng DB. */
  async function seeded() {
    const w = await world();
    w.providers.set(
      "demo",
      fake({
        comment: () => [
          item("comment", "c1", ago(0)),
          item("comment", "c2", ago(1)),
          item("comment", "c3", ago(2)),
          item("comment", "c3b", ago(2)), // trùng giờ với c3
          item("comment", "c4", ago(3)),
          item("comment", "c5", ago(4)),
        ],
        review: () => [
          item("review", "r1", ago(5)),
          item("review", "r2", ago(6)),
        ],
        mention: () => [item("mention", "m1", ago(7))],
      }),
    );
    await w.inbox.sync({
      actorId: "own",
      workspaceId: w.A.id,
      accountId: w.accDemo.id,
    });
    // dữ liệu của workspace khác không được lẫn vào
    await w.inbox.sync({
      actorId: "own-b",
      workspaceId: w.B.id,
      accountId: w.accB.id,
    });
    return w;
  }

  it("F-003/AC-04: lọc theo loại và theo trạng thái, chỉ mục khớp thuộc workspace, mới nhất trước", async () => {
    const w = await seeded();
    const all = await w.listA();
    expect(all.items).toHaveLength(9);
    expect(all.items.every((i) => i.socialAccountId === w.accDemo.id)).toBe(
      true,
    );
    const times = all.items.map((i) => i.receivedAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));

    expect(
      (await w.listA({ kind: "review" })).items.map((i) => i.externalId),
    ).toEqual(["r1", "r2"]);
    expect((await w.listA({ kind: "mention" })).items).toHaveLength(1);
    expect((await w.listA({ kind: "dm" })).items).toHaveLength(0);

    const c1 = all.items.find((i) => i.externalId === "c1")!;
    await w.inbox.setStatus({
      actorId: "own",
      workspaceId: w.A.id,
      itemId: c1.id,
      status: "handled",
    });
    expect(
      (await w.listA({ status: "handled" })).items.map((i) => i.externalId),
    ).toEqual(["c1"]);
    expect((await w.listA({ status: "open" })).items).toHaveLength(8);
    expect(
      (await w.listA({ status: "handled", kind: "review" })).items,
    ).toHaveLength(0);
  });

  it("F-003/AC-04: lật trang bằng cursor không sót, không lặp, kể cả mục trùng giờ", async () => {
    const w = await seeded();
    const expected = (await w.listA()).items.map((i) => i.id);
    for (const limit of [1, 2, 4]) {
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 20; guard++) {
        const page = await w.listA({ limit, cursor });
        expect(page.items.length).toBeLessThanOrEqual(limit);
        seen.push(...page.items.map((i) => i.id));
        if (page.nextCursor === null) break;
        cursor = page.nextCursor;
      }
      expect(seen).toEqual(expected); // đủ, không lặp, đúng thứ tự
      expect(new Set(seen).size).toBe(seen.length);
    }
  });

  it("F-003/AC-04: limit được kẹp vào 1..100", async () => {
    const w = await world();
    w.providers.set(
      "demo",
      fake({
        comment: () =>
          Array.from({ length: 105 }, (_, i) =>
            item("comment", `c${i}`, ago(i)),
          ),
      }),
    );
    await w.inbox.sync({
      actorId: "own",
      workspaceId: w.A.id,
      accountId: w.accDemo.id,
    });
    const big = await w.listA({ limit: 9999 });
    expect(big.items).toHaveLength(100);
    expect(big.nextCursor).not.toBeNull();
    const rest = await w.listA({ limit: 9999, cursor: big.nextCursor! });
    expect(rest.items).toHaveLength(5);
    expect(rest.nextCursor).toBeNull();
    expect((await w.listA({ limit: 0 })).items).toHaveLength(1);
    expect((await w.listA({ limit: -5 })).items).toHaveLength(1);
  });

  it("F-003/AC-04: cursor hỏng là ValidationError", async () => {
    const w = await seeded();
    await expect(w.listA({ cursor: "khong-hop-le!!" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("F-003/AC-05: đánh dấu handled ghi người thao tác, mở lại open thì xoá", async () => {
    const w = await seeded();
    const target = (await w.listA({ kind: "mention" })).items[0]!;
    const done = await w.inbox.setStatus({
      actorId: "mem",
      workspaceId: w.A.id,
      itemId: target.id,
      status: "handled",
    });
    expect(done.status).toBe("handled");
    expect(done.handledBy).toBe("mem");
    const [row] = (await t.db.select().from(inboxItems)).filter(
      (r) => r.id === target.id,
    );
    expect(row?.status).toBe("handled");
    expect(row?.handledBy).toBe("mem");

    const reopened = await w.inbox.setStatus({
      actorId: "own",
      workspaceId: w.A.id,
      itemId: target.id,
      status: "open",
    });
    expect(reopened.status).toBe("open");
    expect(reopened.handledBy).toBeNull();
    const [row2] = (await t.db.select().from(inboxItems)).filter(
      (r) => r.id === target.id,
    );
    expect(row2?.status).toBe("open");
    expect(row2?.handledBy).toBeNull();
  });
});

describe("F-003 webhook", () => {
  it("F-003/AC-06: sự kiện ký đúng nhập tin vào đúng workspace/tài khoản đúng một lần, gửi lại không nhân đôi", async () => {
    const w = await world();
    const first = await w.post(w.connSa.id, commentEvent("c-1"));
    expect(first).toEqual({ status: 200, body: { status: "ok", inserted: 1 } });
    const replay = await w.post(w.connSa.id, commentEvent("c-1"));
    expect(replay).toEqual({
      status: 200,
      body: { status: "ok", inserted: 0 },
    });

    const { items } = await w.listA();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "comment",
      externalId: "c-1",
      author: "An",
      text: "Giá bao nhiêu ạ?",
      status: "open",
      socialAccountId: w.accSa.id,
    });
    expect(items[0]!.receivedAt.toISOString()).toBe(NOW.toISOString());
    // workspace khác không thấy
    expect(
      (await w.inbox.list({ actorId: "own-b", workspaceId: w.B.id })).items,
    ).toHaveLength(0);
  });

  it("F-003/AC-06: sự kiện đánh giá vào hộp thư với loại review", async () => {
    const w = await world();
    const res = await w.post(w.connSa.id, {
      event: "review.received",
      data: {
        account_id: "fb-page-1",
        review: {
          id: "rv-1",
          author: { name: "Bình" },
          text: "Giao nhanh",
          created_at: NOW.toISOString(),
        },
      },
    });
    expect(res.body).toEqual({ status: "ok", inserted: 1 });
    expect((await w.listA({ kind: "review" })).items[0]).toMatchObject({
      externalId: "rv-1",
      author: "Bình",
      text: "Giao nhanh",
    });
  });

  it("F-003/AC-06: mục đã xử lý không bị mở lại vì tin cũ; tin mới hơn mở lại", async () => {
    const w = await world();
    await w.post(w.connSa.id, dmEvent("m-1", "p-1", ago(10)));
    const dm = (await w.listA({ kind: "dm" })).items[0]!;
    await w.inbox.setStatus({
      actorId: "mem",
      workspaceId: w.A.id,
      itemId: dm.id,
      status: "handled",
    });
    const status = async (): Promise<InboxStatus> =>
      (await w.listA({ kind: "dm" })).items[0]!.status;

    await w.post(w.connSa.id, dmEvent("m-1", "p-1", ago(10))); // giao lại
    expect(await status()).toBe("handled");
    await w.post(w.connSa.id, dmEvent("m-0", "p-0", ago(60))); // tin cũ hơn
    expect(await status()).toBe("handled");
    expect(await count(messages)).toBe(2); // tin cũ vẫn được lưu vào hội thoại

    await w.post(w.connSa.id, dmEvent("m-2", "p-2", ago(1))); // tin mới hơn
    const reopened = (await w.listA({ kind: "dm" })).items[0]!;
    expect(reopened.status).toBe("open");
    expect(reopened.handledBy).toBeNull();
    expect(await count(messages)).toBe(3);
    expect(await count(inboxItems)).toBe(1);

    // bình luận đã xử lý cũng không bị mở lại khi nhận lại
    await w.post(w.connSa.id, commentEvent("c-9"));
    const c9 = (await w.listA({ kind: "comment" })).items[0]!;
    await w.inbox.setStatus({
      actorId: "mem",
      workspaceId: w.A.id,
      itemId: c9.id,
      status: "handled",
    });
    await w.post(w.connSa.id, commentEvent("c-9"));
    expect((await w.listA({ kind: "comment" })).items[0]!.status).toBe(
      "handled",
    );
  });

  it("F-003/AC-06: sự kiện không thuộc hộp thư hoặc tài khoản lạ thì 200 bỏ qua, không ghi gì", async () => {
    const w = await world();
    const other = await w.post(w.connSa.id, {
      event: "post.published",
      data: { account_id: "fb-page-1", id: "p" },
    });
    expect(other).toEqual({ status: 200, body: { status: "ignored" } });
    const unknownAcc = await w.post(
      w.connSa.id,
      commentEvent("c-1", NOW, "x", "tai-khoan-la"),
    );
    expect(unknownAcc).toEqual({ status: 200, body: { status: "ignored" } });
    expect(await count(inboxItems)).toBe(0);
    expect(await count(messages)).toBe(0);
  });

  it("F-003/AC-07: chữ ký sai/thiếu, timestamp lệch quá 5 phút, đổi một byte thân đều là cùng một phản hồi 401, không ghi gì", async () => {
    const w = await world();
    const ev = commentEvent("c-1");
    const goodTs = Math.floor(NOW_MS / 1000);
    const cases: Awaited<ReturnType<World["post"]>>[] = [];
    cases.push(
      await w.post(w.connSa.id, ev, { secret: "sai-secret-sai-secret" }),
    );
    cases.push(await w.post(w.connSa.id, ev, { signature: null }));
    cases.push(await w.post(w.connSa.id, ev, { signature: "sha256=zzzz" }));
    cases.push(
      await w.post(w.connSa.id, ev, {
        signature: "sha256=" + "0".repeat(64),
      }),
    );
    cases.push(await w.post(w.connSa.id, ev, { timestamp: null }));
    cases.push(await w.post(w.connSa.id, ev, { timestamp: "abc" }));
    // lệch quá 5 phút (301 giây) về cả hai phía; chữ ký khớp với timestamp đó
    cases.push(await w.post(w.connSa.id, ev, { ts: String(goodTs - 301) }));
    cases.push(await w.post(w.connSa.id, ev, { ts: String(goodTs + 301) }));
    // đổi một byte của thân sau khi ký
    const original = Buffer.from(JSON.stringify(ev));
    const tampered = Buffer.from(JSON.stringify(ev).replace('"c-1"', '"c-2"'));
    cases.push(await w.post(w.connSa.id, tampered, { signedBody: original }));
    for (const c of cases) expect(c).toEqual(UNAUTHORIZED);
    expect(await count(inboxItems)).toBe(0);

    // đúng khi trong cửa sổ (299 giây) — chứng tỏ các ca trên bị từ chối vì lý do xác thực
    const inside = await w.post(w.connSa.id, ev, { ts: String(goodTs - 299) });
    expect(inside.status).toBe(200);
    expect(await count(inboxItems)).toBe(1);
  });

  it("F-003/AC-07: kết nối không tồn tại, chưa bật webhook, khác nhà cung cấp, ký bằng secret của kết nối khác đều 401 như nhau", async () => {
    const w = await world();
    const ev = commentEvent("c-1");
    // kết nối socialapi thứ hai chưa đặt secret
    const noSecret = await w.conns.create({
      actorId: "own",
      workspaceId: w.A.id,
      provider: "socialapi",
      label: "chưa bật",
      credentials: CRED,
    });
    // kết nối demo (khác nhà cung cấp) dù có secret
    await w.conns.setWebhookSecret({
      actorId: "own",
      workspaceId: w.A.id,
      connectionId: w.connDemo.id,
      secret: WH_SECRET,
    });
    // kết nối socialapi khác có secret riêng
    const otherSa = await w.conns.create({
      actorId: "own-b",
      workspaceId: w.B.id,
      provider: "socialapi",
      label: "của B",
      credentials: CRED,
    });
    await w.conns.setWebhookSecret({
      actorId: "own-b",
      workspaceId: w.B.id,
      connectionId: otherSa.id,
      secret: "secret-rieng-cua-B-0123456",
    });

    const results = [
      await w.post(randomUUID(), ev),
      await w.post("khong-phai-uuid", ev),
      await w.post(noSecret.id, ev),
      await w.post(w.connDemo.id, ev),
      // ký bằng secret của B nhưng gửi tới kết nối của A
      await w.post(w.connSa.id, ev, { secret: "secret-rieng-cua-B-0123456" }),
      // ký bằng secret của A nhưng gửi tới kết nối của B
      await w.post(otherSa.id, ev),
    ];
    for (const r of results) expect(r).toEqual(UNAUTHORIZED);
    expect(await count(inboxItems)).toBe(0);
  });

  it("F-003/AC-08: thân > 256 KiB bị 413 trước khi chạm CSDL (kể cả với kết nối không tồn tại)", async () => {
    const w = await world();
    const big = Buffer.alloc(256 * 1024 + 1, "a");
    const unknown = await w.post(randomUUID(), big);
    expect(unknown).toEqual({ status: 413, body: { status: "too_large" } });
    const real = await w.post(w.connSa.id, big);
    expect(real).toEqual({ status: 413, body: { status: "too_large" } });
    expect(await count(inboxItems)).toBe(0);
    // đúng 256 KiB (ca biên) không phải 413: ký đúng nhưng JSON hỏng thì 400
    const edge = await w.post(w.connSa.id, Buffer.alloc(256 * 1024, " "));
    expect(edge).toEqual({ status: 400, body: { status: "invalid" } });
  });

  it("F-003/AC-08: chữ ký đúng nhưng JSON hỏng/thiếu trường/thời gian sai thì 400, không ghi gì", async () => {
    const w = await world();
    const base = commentEvent("c-1").data;
    const bodies: (object | string)[] = [
      "{không phải json",
      "[]",
      "null",
      '"chuỗi"',
      { event: "comment.received" }, // thiếu data
      { event: "comment.received", data: { ...base, account_id: undefined } },
      { event: "comment.received", data: { ...base, id: "" } },
      { event: "comment.received", data: { ...base, author: undefined } },
      {
        event: "comment.received",
        data: { ...base, received_at: "hôm qua" },
      },
      {
        event: "comment.received",
        data: { ...base, received_at: "2026-11-24T08:00:00" }, // thiếu múi giờ
      },
    ];
    for (const b of bodies) {
      const r = await w.post(w.connSa.id, b);
      expect(r).toEqual({ status: 400, body: { status: "invalid" } });
    }
    expect(await count(inboxItems)).toBe(0);
    expect(await count(messages)).toBe(0);
  });
});

describe("F-003 người ngoài và ID lạ", () => {
  it("F-003/AC-09: người ngoài bị Forbidden khi đồng bộ, xem, đổi trạng thái; không gọi nhà cung cấp", async () => {
    const w = await world();
    await w.inbox.sync({
      actorId: "own",
      workspaceId: w.A.id,
      accountId: w.accDemo.id,
    });
    const target = (await w.listA()).items[0]!;
    w.seenCredentials.length = 0;

    await expect(
      w.inbox.sync({
        actorId: "ngoai",
        workspaceId: w.A.id,
        accountId: w.accDemo.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      w.inbox.list({ actorId: "ngoai", workspaceId: w.A.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      w.inbox.setStatus({
        actorId: "ngoai",
        workspaceId: w.A.id,
        itemId: target.id,
        status: "handled",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // owner của workspace B cũng là người ngoài với A
    await expect(
      w.inbox.list({ actorId: "own-b", workspaceId: w.A.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(w.seenCredentials).toHaveLength(0);
    expect(
      (await w.listA()).items.find((i) => i.id === target.id)?.status,
    ).toBe("open");
  });

  it("F-003/AC-09: ID tài khoản/mục của workspace khác hoặc không phải UUID là NotFound; không gọi nhà cung cấp", async () => {
    const w = await world();
    await w.inbox.sync({
      actorId: "own-b",
      workspaceId: w.B.id,
      accountId: w.accB.id,
    });
    const itemB = (
      await w.inbox.list({ actorId: "own-b", workspaceId: w.B.id })
    ).items[0]!;
    w.seenCredentials.length = 0;

    for (const accountId of [w.accB.id, randomUUID(), "khong-phai-uuid"])
      await expect(
        w.inbox.sync({ actorId: "own", workspaceId: w.A.id, accountId }),
      ).rejects.toBeInstanceOf(NotFoundError);
    for (const itemId of [itemB.id, randomUUID(), "khong-phai-uuid"])
      await expect(
        w.inbox.setStatus({
          actorId: "own",
          workspaceId: w.A.id,
          itemId,
          status: "handled",
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    expect(w.seenCredentials).toHaveLength(0);
    // mục của B không đổi
    expect(
      (await w.inbox.list({ actorId: "own-b", workspaceId: w.B.id })).items[0]!
        .status,
    ).toBe("open");
  });

  it("F-003/AC-09: trạng thái lạ là ValidationError và không đổi gì", async () => {
    const w = await world();
    await w.inbox.sync({
      actorId: "own",
      workspaceId: w.A.id,
      accountId: w.accDemo.id,
    });
    const target = (await w.listA()).items[0]!;
    await expect(
      w.inbox.setStatus({
        actorId: "own",
        workspaceId: w.A.id,
        itemId: target.id,
        status: "archived" as InboxStatus,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(
      (await w.listA()).items.find((i) => i.id === target.id)?.status,
    ).toBe("open");
  });
});
