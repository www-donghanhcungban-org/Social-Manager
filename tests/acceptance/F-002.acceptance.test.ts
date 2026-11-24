/**
 * Nghiệm thu F-002 — Kết nối nhà cung cấp và tài khoản mạng xã hội.
 * Viết từ docs/specs/F-002-provider-accounts.md và hợp đồng công khai (chữ ký hàm xuất của src/**): dịch vụ kết nối,
 * dịch vụ tài khoản, `src/providers/actions`, client SocialAPI. Chạy trên PGlite thật qua tests/db/helpers, fetch giả
 * được tiêm (không mạng), không gửi tin thật.
 *
 * Không phủ bằng nghiệm thu tự động:
 * - AC-02 (phần "ô khoá là password, không điền lại sau khi lưu" ở trang `/app/<ws>/connections`): chỉ kiểm được qua giao
 *   diện trình duyệt (e2e `connections.spec.ts`). Phần "danh sách chỉ có các trường không nhạy cảm" được phủ bên dưới.
 * - AC-08 (phần "log không chứa khoá"): log nằm ở lớp quan sát/biên của tiến trình; nghiệm thu chỉ khẳng định thông
 *   điệp lỗi trả ra và đối tượng lỗi không chứa khoá.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createAccountService } from "@/src/accounts/service";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/src/auth/errors";
import { addMember } from "@/src/auth/members";
import { createConnectionService } from "@/src/connections/service";
import { providerConnections, socialAccounts } from "@/src/db/schema";
import { publishPost, sendMessage, listInbox } from "@/src/providers/actions";
import { createDemoProvider } from "@/src/providers/demo";
import { createRegistry } from "@/src/providers/registry";
import {
  createSocialApiClient,
  createSocialApiProvider,
  SocialApiError,
} from "@/src/providers/socialapi";
import {
  UnsupportedError,
  ValidationError,
  type SocialProvider,
} from "@/src/providers/types";
import { createSecretBox } from "@/src/security/secret-box";
import { createWorkspaceService } from "@/src/workspaces/service";

import { createTestDb } from "../db/helpers";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const MASTER_KEY = Buffer.alloc(32, 5).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 6).toString("base64");
const API_KEY = "sk-live-RAHASIA-123456";

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

/** Provider tự dựng: chỉ khai facebook (dm, comments), tiktok khai rỗng. Không cài hàm hành động nào. */
const limited: SocialProvider = {
  id: "limited",
  label: "Hạn chế",
  support: { facebook: ["dm", "comments"], tiktok: [] },
};

async function world() {
  const box = createSecretBox(MASTER_KEY);
  const registry = createRegistry();
  registry.register(createDemoProvider());
  registry.register(createSocialApiProvider({ apiKey: "x", fetch: noNetwork }));
  registry.register(limited);
  const conns = createConnectionService({ db: t.db, box, registry });
  const accts = createAccountService({ db: t.db, registry });
  const ws = createWorkspaceService({ db: t.db });
  const W = await ws.create({ actorId: "own", name: "Cửa hàng W" });
  const W2 = await ws.create({ actorId: "own2", name: "Cửa hàng khác" });
  for (const [userId, role] of [
    ["adm", "admin"],
    ["mem", "member"],
  ] as const)
    await addMember(t.db, {
      actorId: "own",
      workspaceId: W.id,
      userId,
      role,
    });
  const create = (
    over: Partial<Parameters<typeof conns.create>[0]> = {},
  ): ReturnType<typeof conns.create> =>
    conns.create({
      actorId: "own",
      workspaceId: W.id,
      provider: "demo",
      label: "Kết nối chính",
      credentials: API_KEY,
      ...over,
    });
  return { box, registry, conns, accts, W, W2, create };
}

const rejectsWith = async (
  p: Promise<unknown>,
  cls: abstract new (...a: never[]) => Error,
) => expect(p).rejects.toBeInstanceOf(cls);

describe("F-002 kết nối và khoá", () => {
  it("F-002/AC-01: khoá lưu AES-256-GCM tiền tố v1:, IV ngẫu nhiên; giá trị trả về và cột DB không chứa bản rõ", async () => {
    const w = await world();
    const a = await w.create({ label: "a" });
    const b = await w.create({ label: "b" });
    expect(JSON.stringify(a)).not.toContain(API_KEY);
    expect(JSON.stringify(a)).not.toContain("v1:");

    const rows = await t.db.select().from(providerConnections);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.credentialsEnc.startsWith("v1:")).toBe(true);
      expect(r.credentialsEnc).not.toContain(API_KEY);
      // khoá chủ APP_SECRET_KEY giải mã được về đúng khoá ban đầu
      expect(createSecretBox(MASTER_KEY).decrypt(r.credentialsEnc)).toBe(
        API_KEY,
      );
    }
    // IV ngẫu nhiên: cùng khoá lưu hai lần cho hai bản mã khác nhau
    expect(rows[0]!.credentialsEnc).not.toBe(rows[1]!.credentialsEnc);
    // bản mã không giải được bằng khoá chủ khác
    expect(() =>
      createSecretBox(OTHER_KEY).decrypt(rows[0]!.credentialsEnc),
    ).toThrow();
    expect(a.id).not.toBe(b.id);
  });

  it("F-002/AC-02: danh sách chỉ có id, provider, label, webhookEnabled, createdAt, workspaceId; không thấy kết nối workspace khác", async () => {
    const w = await world();
    await w.create({ label: "của W" });
    await w.conns.create({
      actorId: "own2",
      workspaceId: w.W2.id,
      provider: "demo",
      label: "của W2",
      credentials: "khoa-W2",
    });
    // thành viên bất kỳ (kể cả member) xem được
    const list = await w.conns.list({ actorId: "mem", workspaceId: w.W.id });
    expect(list).toHaveLength(1);
    expect(list[0]!.label).toBe("của W");
    expect(Object.keys(list[0]!).sort()).toEqual(
      [
        "createdAt",
        "id",
        "label",
        "provider",
        "webhookEnabled",
        "workspaceId",
      ].sort(),
    );
    expect(list[0]!.webhookEnabled).toBe(false);
    const json = JSON.stringify(list);
    expect(json).not.toContain(API_KEY);
    expect(json).not.toContain("v1:");
    expect(list.every((c) => c.workspaceId === w.W.id)).toBe(true);
  });

  it("F-002/AC-03: member và người ngoài không tạo/xoá kết nối, không thêm/xoá tài khoản; DB không đổi", async () => {
    const w = await world();
    const conn = await w.create();
    const acc = await w.accts.add({
      actorId: "own",
      workspaceId: w.W.id,
      connectionId: conn.id,
      platform: "facebook",
      externalId: "fb-1",
      displayName: "Trang 1",
    });
    for (const actorId of ["mem", "stranger"]) {
      await rejectsWith(
        w.create({ actorId, label: "xâm nhập" }),
        ForbiddenError,
      );
      await rejectsWith(
        w.conns.remove({
          actorId,
          workspaceId: w.W.id,
          connectionId: conn.id,
        }),
        ForbiddenError,
      );
      await rejectsWith(
        w.accts.add({
          actorId,
          workspaceId: w.W.id,
          connectionId: conn.id,
          platform: "facebook",
          externalId: "fb-2",
          displayName: "Trang 2",
        }),
        ForbiddenError,
      );
      await rejectsWith(
        w.accts.remove({
          actorId,
          workspaceId: w.W.id,
          accountId: acc.id,
        }),
        ForbiddenError,
      );
    }
    expect(await t.db.select().from(providerConnections)).toHaveLength(1);
    expect(await t.db.select().from(socialAccounts)).toHaveLength(1);
    // người ngoài xem danh sách cũng bị Forbidden
    await rejectsWith(
      w.conns.list({ actorId: "stranger", workspaceId: w.W.id }),
      ForbiddenError,
    );
    await rejectsWith(
      w.accts.list({ actorId: "stranger", workspaceId: w.W.id }),
      ForbiddenError,
    );
    // admin thì được
    await expect(
      w.create({ actorId: "adm", label: "do admin" }),
    ).resolves.toBeDefined();
  });

  it("F-002/AC-04: nhà cung cấp chưa đăng ký, nhãn rỗng, khoá rỗng/khoảng trắng đều là ValidationError", async () => {
    const w = await world();
    await rejectsWith(w.create({ provider: "khong-co" }), ValidationError);
    await rejectsWith(w.create({ label: "" }), ValidationError);
    await rejectsWith(w.create({ label: "   " }), ValidationError);
    await rejectsWith(w.create({ credentials: "" }), ValidationError);
    await rejectsWith(w.create({ credentials: "  \t " }), ValidationError);
    expect(await t.db.select().from(providerConnections)).toHaveLength(0);
  });

  it("F-002/AC-04: nhãn trùng sau chuẩn hoá NFC là duplicate_label; workspace khác được trùng", async () => {
    const w = await world();
    await w.create({ label: "Café" }); // dạng dựng sẵn
    const dup = w.create({ label: "  Café " }); // dạng tổ hợp + khoảng trắng
    await rejectsWith(dup, ConflictError);
    await expect(dup).rejects.toMatchObject({ reason: "duplicate_label" });
    expect(await t.db.select().from(providerConnections)).toHaveLength(1);
    await expect(
      w.conns.create({
        actorId: "own2",
        workspaceId: w.W2.id,
        provider: "demo",
        label: "Café",
        credentials: "khoa",
      }),
    ).resolves.toMatchObject({ label: "Café" });
  });

  it("F-002/AC-04: hai yêu cầu tạo cùng nhãn cùng lúc chỉ có một bản ghi, yêu cầu kia nhận duplicate_label", async () => {
    const w = await world();
    const results = await Promise.allSettled([
      w.create({ label: "Đua" }),
      w.create({ label: "Đua" }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect(bad[0]!.reason).toMatchObject({ reason: "duplicate_label" });
    expect(await t.db.select().from(providerConnections)).toHaveLength(1);
  });
});

describe("F-002 tài khoản mạng xã hội", () => {
  async function withConn() {
    const w = await world();
    const conn = await w.create();
    const add = (over: Partial<Parameters<typeof w.accts.add>[0]> = {}) =>
      w.accts.add({
        actorId: "own",
        workspaceId: w.W.id,
        connectionId: conn.id,
        platform: "facebook",
        externalId: "fb-1",
        displayName: "Trang 1",
        ...over,
      });
    return { ...w, conn, add };
  }

  it("F-002/AC-05: thêm tài khoản gắn đúng kết nối, dạng xem không có khoá; chuẩn hoá NFC và cắt khoảng trắng", async () => {
    const w = await withConn();
    const view = await w.add({ displayName: "  Café  " });
    expect(view.connectionId).toBe(w.conn.id);
    expect(view.platform).toBe("facebook");
    expect(view.externalId).toBe("fb-1");
    expect(view.displayName).toBe("Café");
    const json = JSON.stringify(view);
    expect(json).not.toContain(API_KEY);
    expect(json).not.toContain("v1:");
    const list = await w.accts.list({ actorId: "mem", workspaceId: w.W.id });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      connectionLabel: "Kết nối chính",
      provider: "demo",
    });
    expect(JSON.stringify(list)).not.toContain("v1:");
  });

  it("F-002/AC-05: id ngoài hoặc tên rỗng / dài hơn 200 ký tự bị từ chối; đúng 200 thì được", async () => {
    const w = await withConn();
    await rejectsWith(w.add({ externalId: "" }), ValidationError);
    await rejectsWith(w.add({ externalId: "   " }), ValidationError);
    await rejectsWith(w.add({ displayName: "" }), ValidationError);
    await rejectsWith(w.add({ displayName: "x".repeat(201) }), ValidationError);
    await rejectsWith(w.add({ externalId: "x".repeat(201) }), ValidationError);
    expect(await t.db.select().from(socialAccounts)).toHaveLength(0);
    await expect(
      w.add({ externalId: "x".repeat(200), displayName: "y".repeat(200) }),
    ).resolves.toBeDefined();
  });

  it("F-002/AC-05: kết nối của workspace khác hoặc id lạ là NotFound", async () => {
    const w = await withConn();
    const other = await w.conns.create({
      actorId: "own2",
      workspaceId: w.W2.id,
      provider: "demo",
      label: "của W2",
      credentials: "k",
    });
    await rejectsWith(w.add({ connectionId: other.id }), NotFoundError);
    await rejectsWith(
      w.add({ connectionId: "6f1c2c9e-5b0a-4a53-9a39-7a8f0d3b1e11" }),
      NotFoundError,
    );
    await rejectsWith(
      w.add({ connectionId: "khong-phai-uuid" }),
      NotFoundError,
    );
    expect(await t.db.select().from(socialAccounts)).toHaveLength(0);
  });

  it("F-002/AC-05: trùng (kết nối, nền tảng, id ngoài) là duplicate_account, không ghi đè", async () => {
    const w = await withConn();
    await w.add({ displayName: "Tên đầu" });
    const dup = w.add({ displayName: "Tên khác" });
    await rejectsWith(dup, ConflictError);
    await expect(dup).rejects.toMatchObject({ reason: "duplicate_account" });
    const rows = await t.db.select().from(socialAccounts);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.displayName).toBe("Tên đầu");
    // nền tảng khác với cùng id ngoài thì là tài khoản khác
    await expect(w.add({ platform: "instagram" })).resolves.toBeDefined();
  });

  it("F-002/AC-06: thêm tài khoản của nền tảng nhà cung cấp không khai hỗ trợ là ValidationError", async () => {
    const w = await world();
    const conn = await w.create({ provider: "limited", label: "hạn chế" });
    const add = (platform: string) =>
      w.accts.add({
        actorId: "own",
        workspaceId: w.W.id,
        connectionId: conn.id,
        platform,
        externalId: "ext-1",
        displayName: "Tên",
      });
    await rejectsWith(add("tiktok"), ValidationError); // khai rỗng
    await rejectsWith(add("zalo"), ValidationError); // không khai
    await rejectsWith(add("khong-ton-tai"), ValidationError); // không phải nền tảng
    expect(await t.db.select().from(socialAccounts)).toHaveLength(0);
    await expect(add("facebook")).resolves.toBeDefined();
  });

  it("F-002/AC-06: đăng bài lên Telegram qua SocialAPI là UnsupportedError có nền tảng và khả năng, trước khi gọi mạng", async () => {
    const fetchSpy = vi.fn<typeof fetch>(noNetwork);
    const socialapi = createSocialApiProvider({ apiKey: "x", fetch: fetchSpy });
    const err = await publishPost(socialapi, {
      platform: "telegram",
      accountId: "tg-1",
      text: "xin chào",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnsupportedError);
    expect(err).toMatchObject({
      platform: "telegram",
      capability: "publish",
      code: "unsupported",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("F-002/AC-06: khai hỗ trợ mà thiếu cài đặt là not_implemented, không trả mảng rỗng giả", async () => {
    // `limited` khai facebook: comments/dm nhưng không cài listInbox/sendMessage
    const list = listInbox(limited, {
      platform: "facebook",
      accountId: "fb-1",
      kind: "comment",
    });
    await expect(list).rejects.toBeInstanceOf(UnsupportedError);
    await expect(list).rejects.toMatchObject({
      code: "not_implemented",
      platform: "facebook",
      capability: "comments",
    });
    await expect(
      sendMessage(limited, {
        platform: "facebook",
        accountId: "fb-1",
        conversationId: "c-1",
        text: "chào",
      }),
    ).rejects.toMatchObject({ code: "not_implemented", capability: "dm" });
    // khả năng không khai cho nền tảng đó: unsupported
    await expect(
      listInbox(limited, {
        platform: "facebook",
        accountId: "fb-1",
        kind: "review",
      }),
    ).rejects.toMatchObject({ code: "unsupported", capability: "reviews" });
  });
});

describe("F-002 client SocialAPI", () => {
  const Shape = z.object({ data: z.array(z.object({ id: z.string() })) });
  const json = (body: unknown, init: ResponseInit = { status: 200 }) =>
    new Response(JSON.stringify(body), init);

  it("F-002/AC-07: phản hồi 200 sai hình dạng là client.invalid_response", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ data: "sai" }));
    const client = createSocialApiClient({ apiKey: API_KEY, fetch: fetchMock });
    const err = await client.get("/x", Shape).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SocialApiError);
    expect(err).toMatchObject({ code: "client.invalid_response" });

    const notJson = vi.fn<typeof fetch>(async () => new Response("<html>"));
    const client2 = createSocialApiClient({ apiKey: API_KEY, fetch: notJson });
    await expect(client2.get("/x", Shape)).rejects.toMatchObject({
      code: "client.invalid_response",
    });
  });

  it("F-002/AC-07: 429 có Retry-After hợp lệ thì chờ đúng số giây rồi thử lại", async () => {
    const sleep = vi.fn(async (ms: number) => void ms);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("", { status: 429, headers: { "Retry-After": "2" } }),
      )
      .mockResolvedValueOnce(json({ data: [{ id: "a" }] }));
    const client = createSocialApiClient({
      apiKey: API_KEY,
      fetch: fetchMock,
      sleep,
    });
    await expect(client.get("/x", Shape)).resolves.toEqual({
      data: [{ id: "a" }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("F-002/AC-07: Retry-After quá lớn bị cắt theo trần, không treo", async () => {
    const sleep = vi.fn(async (ms: number) => void ms);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("", { status: 429, headers: { "Retry-After": "999999" } }),
      )
      .mockResolvedValueOnce(json({ data: [] }));
    const client = createSocialApiClient({
      apiKey: API_KEY,
      fetch: fetchMock,
      sleep,
      maxWaitMs: 5000,
    });
    await client.get("/x", Shape);
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it("F-002/AC-07: dừng sau maxRetries khi 429 kéo dài", async () => {
    const sleep = vi.fn(async (ms: number) => void ms);
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response("", { status: 429, headers: { "Retry-After": "1" } }),
    );
    const client = createSocialApiClient({
      apiKey: API_KEY,
      fetch: fetchMock,
      sleep,
      maxRetries: 2,
    });
    await expect(client.get("/x", Shape)).rejects.toMatchObject({
      status: 429,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 lần đầu + 2 lần thử lại
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("F-002/AC-07: không có Retry-After hoặc Retry-After dạng ngày/âm/không phải số thì không thử lại", async () => {
    for (const header of [
      undefined,
      "Wed, 21 Oct 2026 07:28:00 GMT",
      "-5",
      "abc",
      "1.5",
    ]) {
      const sleep = vi.fn(async (ms: number) => void ms);
      const fetchMock = vi.fn<typeof fetch>(
        async () =>
          new Response("", {
            status: 429,
            headers: header === undefined ? {} : { "Retry-After": header },
          }),
      );
      const client = createSocialApiClient({
        apiKey: API_KEY,
        fetch: fetchMock,
        sleep,
      });
      await expect(client.get("/x", Shape)).rejects.toMatchObject({
        status: 429,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    }
  });

  it("F-002/AC-07: data null từ nhà cung cấp thành mảng rỗng", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ data: null }));
    const provider = createSocialApiProvider({
      apiKey: API_KEY,
      fetch: fetchMock,
    });
    const page = await provider.listConversations!({
      platform: "facebook",
      accountId: "fb-1",
    });
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it("F-002/AC-08: mạng đứt báo client.network và không lộ khoá", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error(`ECONNRESET https://api.example/?key=${API_KEY}`);
    });
    const client = createSocialApiClient({ apiKey: API_KEY, fetch: fetchMock });
    const err = await client.get("/x", Shape).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SocialApiError);
    expect(err).toMatchObject({ code: "client.network" });
    const e = err as SocialApiError;
    expect(e.message).not.toContain(API_KEY);
    expect(String(e)).not.toContain(API_KEY);
    expect(JSON.stringify({ ...e, message: e.message })).not.toContain(API_KEY);
  });

  it("F-002/AC-08: nhà cung cấp treo thì báo client.timeout và không lộ khoá", async () => {
    const hanging = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error(`aborted with ${API_KEY}`)),
          );
        }),
    );
    const client = createSocialApiClient({
      apiKey: API_KEY,
      fetch: hanging,
      timeoutMs: 30,
    });
    const err = await client.get("/x", Shape).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "client.timeout" });
    expect((err as Error).message).not.toContain(API_KEY);
  });
});

describe("F-002 bản mã hỏng", () => {
  it("F-002/AC-09: bản mã bị sửa thì giải mã ném lỗi, không trả chuỗi rác", async () => {
    const w = await world();
    const conn = await w.create();
    await expect(
      w.conns.credentialsFor({ workspaceId: w.W.id, connectionId: conn.id }),
    ).resolves.toBe(API_KEY);

    const [row] = await t.db.select().from(providerConnections);
    const enc = row!.credentialsEnc;
    const tampered = enc.slice(0, -3) + (enc.endsWith("AAA") ? "BBB" : "AAA");
    await t.db
      .update(providerConnections)
      .set({ credentialsEnc: tampered })
      .where(eq(providerConnections.id, conn.id));
    await expect(
      w.conns.credentialsFor({ workspaceId: w.W.id, connectionId: conn.id }),
    ).rejects.toThrow();

    // bản mã không đúng định dạng
    await t.db
      .update(providerConnections)
      .set({ credentialsEnc: "khong-phai-ban-ma" })
      .where(eq(providerConnections.id, conn.id));
    await expect(
      w.conns.credentialsFor({ workspaceId: w.W.id, connectionId: conn.id }),
    ).rejects.toThrow();
  });

  it("F-002/AC-09: khoá chủ sai thì ném lỗi", async () => {
    const w = await world();
    const conn = await w.create();
    const wrongKeyConns = createConnectionService({
      db: t.db,
      box: createSecretBox(OTHER_KEY),
      registry: w.registry,
    });
    await expect(
      wrongKeyConns.credentialsFor({
        workspaceId: w.W.id,
        connectionId: conn.id,
      }),
    ).rejects.toThrow();
  });

  it("F-002/AC-09: kết nối của workspace khác không giải mã được (NotFound)", async () => {
    const w = await world();
    const conn = await w.create();
    await expect(
      w.conns.credentialsFor({ workspaceId: w.W2.id, connectionId: conn.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("F-002 secret webhook", () => {
  const SECRET_OK = "abcdefghij123456"; // 16 ký tự

  it("F-002/AC-10: owner/admin đặt secret 16-256 ký tự: lưu bản mã, chỉ trả webhookEnabled; xoá bằng null", async () => {
    const w = await world();
    const conn = await w.create({ provider: "socialapi", label: "sa" });
    const set = (secret: string | null, actorId = "own") =>
      w.conns.setWebhookSecret({
        actorId,
        workspaceId: w.W.id,
        connectionId: conn.id,
        secret,
      });

    const view = await set(SECRET_OK, "adm");
    expect(view.webhookEnabled).toBe(true);
    expect(JSON.stringify(view)).not.toContain(SECRET_OK);
    let [row] = await t.db.select().from(providerConnections);
    expect(row!.webhookSecretEnc).not.toBeNull();
    expect(row!.webhookSecretEnc!.startsWith("v1:")).toBe(true);
    expect(row!.webhookSecretEnc).not.toContain(SECRET_OK);
    expect(createSecretBox(MASTER_KEY).decrypt(row!.webhookSecretEnc!)).toBe(
      SECRET_OK,
    );
    // đúng 256 ký tự cũng được
    await expect(set("s".repeat(256))).resolves.toMatchObject({
      webhookEnabled: true,
    });

    const cleared = await set(null);
    expect(cleared.webhookEnabled).toBe(false);
    [row] = await t.db.select().from(providerConnections);
    expect(row!.webhookSecretEnc).toBeNull();
  });

  it("F-002/AC-10: secret ngắn, dài hoặc có khoảng trắng bị từ chối và không đổi gì", async () => {
    const w = await world();
    const conn = await w.create({ provider: "socialapi", label: "sa" });
    const set = (secret: string) =>
      w.conns.setWebhookSecret({
        actorId: "own",
        workspaceId: w.W.id,
        connectionId: conn.id,
        secret,
      });
    for (const bad of [
      "a".repeat(15),
      "a".repeat(257),
      "abcdefgh ijklmnopq",
      "  abcdefghij123456",
      "abcdefghij123456 ",
      "abcdefgh\tijklmnopq",
      "abcdefghij\n123456",
      "",
    ])
      await rejectsWith(set(bad), ValidationError);
    const [row] = await t.db.select().from(providerConnections);
    expect(row!.webhookSecretEnc).toBeNull();
  });

  it("F-002/AC-10: member, người ngoài và workspace khác không đặt được", async () => {
    const w = await world();
    const conn = await w.create({ provider: "socialapi", label: "sa" });
    for (const actorId of ["mem", "stranger"])
      await rejectsWith(
        w.conns.setWebhookSecret({
          actorId,
          workspaceId: w.W.id,
          connectionId: conn.id,
          secret: SECRET_OK,
        }),
        ForbiddenError,
      );
    // owner của workspace khác dùng ID kết nối của W trong workspace của mình
    await rejectsWith(
      w.conns.setWebhookSecret({
        actorId: "own2",
        workspaceId: w.W2.id,
        connectionId: conn.id,
        secret: SECRET_OK,
      }),
      NotFoundError,
    );
    // ... hoặc gọi thẳng vào W
    await rejectsWith(
      w.conns.setWebhookSecret({
        actorId: "own2",
        workspaceId: w.W.id,
        connectionId: conn.id,
        secret: SECRET_OK,
      }),
      ForbiddenError,
    );
    const [row] = await t.db.select().from(providerConnections);
    expect(row!.webhookSecretEnc).toBeNull();
  });
});
