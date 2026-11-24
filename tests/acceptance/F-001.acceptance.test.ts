/**
 * Nghiệm thu F-001 — Đăng ký, đăng nhập, workspace nhiều thành viên.
 * Viết từ docs/specs/F-001-workspace-auth.md và hợp đồng công khai (docs/API-CONTRACT.md, chữ ký hàm xuất của src/**),
 * chạy trên PGlite thật qua tests/db/helpers (migration thật), không mock nội bộ, không mạng.
 *
 * Không phủ bằng nghiệm thu tự động:
 * - AC-05 (phần trang `/app/<A>` trả "không tìm thấy", không lộ tên): kiểm qua trang render trong trình duyệt/Next
 *   (e2e `auth-flow`), không gọi được ở tầng dịch vụ. Phần NotFound/Forbidden của dịch vụ vẫn được phủ bên dưới.
 * - AC-09 (phần cookie `__Host-`/HttpOnly trên trình duyệt thật): thuộc tính trình duyệt; phần phiên hết hiệu lực
 *   (đăng xuất, hết hạn, bị gỡ khỏi workspace) vẫn được phủ bên dưới.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAccountService } from "@/src/accounts/service";
import { createAuth } from "@/src/auth/auth";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/src/auth/errors";
import {
  addMember,
  changeRole,
  getRole,
  removeMember,
} from "@/src/auth/members";
import { ACTIONS, can, type Action } from "@/src/auth/permissions";
import { lockSeconds } from "@/src/auth/throttle";
import { createConnectionService } from "@/src/connections/service";
import {
  inboxItems,
  loginThrottle,
  members,
  providerConnections,
  session,
  socialAccounts,
  user,
  workspaces,
} from "@/src/db/schema";
import { createInboxService } from "@/src/inbox/service";
import { createPostService } from "@/src/posts/service";
import { createDemoProvider } from "@/src/providers/demo";
import { createRegistry } from "@/src/providers/registry";
import { ValidationError } from "@/src/providers/types";
import { createSecretBox } from "@/src/security/secret-box";
import {
  createWorkspaceService,
  MAX_WORKSPACES_PER_USER,
} from "@/src/workspaces/service";

import { createTestDb } from "../db/helpers";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SECRET = "s".repeat(48);
const PASSWORD = "mat-khau-du-dai-123";
const BASE_URL = "http://localhost:3000";

let t: Awaited<ReturnType<typeof createTestDb>>;
let auth: ReturnType<typeof createAuth>;

beforeEach(async () => {
  t = await createTestDb();
  auth = createAuth({ db: t.db, secret: SECRET, baseURL: BASE_URL });
});
afterEach(async () => {
  await t.client.close();
});

const signUp = (email = "lan@example.com", password = PASSWORD) =>
  auth.api.signUpEmail({ body: { name: "Lan", email, password } });

const signIn = (email: string, password: string) =>
  auth.api.signInEmail({ body: { email, password }, returnHeaders: true });

/** Đăng nhập, trả header có cookie phiên để gọi getSession/signOut. */
async function login(email = "lan@example.com", password = PASSWORD) {
  const { headers } = await signIn(email, password);
  const cookie = (headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
  return new Headers({ cookie });
}

const workspacesSvc = () => createWorkspaceService({ db: t.db });

async function expectRejects<E extends Error>(
  p: Promise<unknown>,
  cls: new (...a: never[]) => E,
) {
  await expect(p).rejects.toBeInstanceOf(cls);
}

describe("F-001 đăng ký và mật khẩu", () => {
  it("F-001/AC-01: đăng ký tạo người dùng, mật khẩu lưu PHC argon2id (m>=19456, t>=2, p=1), không có bản rõ", async () => {
    await signUp();
    const users = await t.db.select().from(user);
    expect(users).toHaveLength(1);
    expect(users[0]?.email).toBe("lan@example.com");

    const rows = await t.client.query<{ password: string }>(
      `select password from account where provider_id = 'credential'`,
    );
    expect(rows.rows).toHaveLength(1);
    const phc = rows.rows[0]!.password;
    expect(phc).not.toContain(PASSWORD);
    const m = /^\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(phc);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(19456);
    expect(Number(m![2])).toBeGreaterThanOrEqual(2);
    expect(Number(m![3])).toBe(1);
  });

  it("F-001/AC-01: email chuẩn hoá thường, đăng nhập bằng chữ thường vẫn được", async () => {
    await signUp("Lan@Example.COM");
    const users = await t.db.select().from(user);
    expect(users[0]?.email).toBe("lan@example.com");
    const headers = await login("lan@example.com");
    expect(headers.get("cookie")).toBeTruthy();
  });

  it("F-001/AC-01: mật khẩu dài hơn 72 byte vẫn phân biệt được phần đuôi", async () => {
    const long = "a".repeat(80);
    await signUp("dai@example.com", long + "X");
    await expect(signIn("dai@example.com", long + "X")).resolves.toBeDefined();
    await expect(signIn("dai@example.com", long + "Y")).rejects.toMatchObject({
      body: { code: "INVALID_EMAIL_OR_PASSWORD" },
    });
  });

  it("F-001/AC-03: mật khẩu ngắn hơn 12 ký tự bị từ chối, không tạo người dùng", async () => {
    await expect(
      signUp("ngan@example.com", "a".repeat(11)),
    ).rejects.toMatchObject({ body: { code: "PASSWORD_TOO_SHORT" } });
    await expect(signUp("rong@example.com", "")).rejects.toBeDefined();
    expect(await t.db.select().from(user)).toHaveLength(0);
  });

  it("F-001/AC-03: đúng 12 ký tự được chấp nhận (ca biên)", async () => {
    await signUp("bien@example.com", "a".repeat(12));
    expect(await t.db.select().from(user)).toHaveLength(1);
  });

  it("F-001/AC-03: email trùng (kể cả khác hoa/thường) không tạo thêm người dùng, không đổi mật khẩu", async () => {
    await signUp("lan@example.com");
    await signUp("lan@example.com", "mat-khau-khac-456789").catch(() => {});
    await signUp("LAN@Example.com", "mat-khau-khac-456789").catch(() => {});
    expect(await t.db.select().from(user)).toHaveLength(1);
    await expect(login("lan@example.com", PASSWORD)).resolves.toBeInstanceOf(
      Headers,
    );
    await expect(
      signIn("lan@example.com", "mat-khau-khac-456789"),
    ).rejects.toMatchObject({ body: { code: "INVALID_EMAIL_OR_PASSWORD" } });
  });

  it("F-001/AC-03: phản hồi cho email đã có giống email mới và không cấp phiên", async () => {
    await signUp("lan@example.com");
    const existing = await signUp("lan@example.com", "mat-khau-khac-456789");
    const fresh = await signUp("moi@example.com");
    expect(existing.token).toBeNull();
    expect(fresh.token).toBeNull();
    expect(Object.keys(existing).sort()).toEqual(Object.keys(fresh).sort());
    expect(await t.db.select().from(session)).toHaveLength(0);
  });

  it("F-001/AC-03: sai mật khẩu và email không tồn tại cho cùng một phản hồi 401", async () => {
    await signUp();
    const wrongPw = await signIn("lan@example.com", "sai-mat-khau-123").catch(
      (e: unknown) => e,
    );
    const ghost = await signIn("ghost@example.com", "sai-mat-khau-123").catch(
      (e: unknown) => e,
    );
    for (const e of [wrongPw, ghost]) {
      expect(e).toMatchObject({
        statusCode: 401,
        body: { code: "INVALID_EMAIL_OR_PASSWORD" },
      });
    }
    expect((wrongPw as { body: unknown }).body).toEqual(
      (ghost as { body: unknown }).body,
    );
  });
});

describe("F-001 tạo workspace", () => {
  it("F-001/AC-02: người tạo là owner; tên chuẩn hoá NFC và cắt khoảng trắng", async () => {
    const ws = await workspacesSvc().create({
      actorId: "u1",
      name: "  Café Hoa  ",
    });
    expect(ws.name).toBe("Café Hoa");
    expect(ws.role).toBe("owner");
    expect(await getRole(t.db, ws.id, "u1")).toBe("owner");
    const [row] = await t.db.select().from(workspaces);
    expect(row?.name).toBe("Café Hoa");
  });

  it("F-001/AC-02: tên rỗng, chỉ khoảng trắng, > 100 ký tự hoặc actorId rỗng bị từ chối, không tạo gì", async () => {
    const svc = workspacesSvc();
    await expectRejects(
      svc.create({ actorId: "u1", name: "" }),
      ValidationError,
    );
    await expectRejects(
      svc.create({ actorId: "u1", name: "   " }),
      ValidationError,
    );
    await expectRejects(
      svc.create({ actorId: "u1", name: "x".repeat(101) }),
      ValidationError,
    );
    await expectRejects(
      svc.create({ actorId: "", name: "Hợp lệ" }),
      ValidationError,
    );
    expect(await t.db.select().from(workspaces)).toHaveLength(0);
    expect(await t.db.select().from(members)).toHaveLength(0);
    // đúng 100 ký tự thì được
    const ok = await svc.create({ actorId: "u1", name: "x".repeat(100) });
    expect(ok.name).toHaveLength(100);
  });

  it("F-001/AC-02: lỗi giữa chừng ở bước ghi owner thì không còn workspace mồ côi", async () => {
    await t.client.exec(`
      create function fail_member_insert() returns trigger language plpgsql as $$
      begin raise exception 'ghi owner thất bại'; end $$;
      create trigger fail_member_insert before insert on members
        for each row execute function fail_member_insert();
    `);
    await expect(
      workspacesSvc().create({ actorId: "u1", name: "Sẽ hỏng" }),
    ).rejects.toThrow();
    expect(await t.db.select().from(workspaces)).toHaveLength(0);
    expect(await t.db.select().from(members)).toHaveLength(0);
  });

  it("F-001/AC-02: mỗi người tối đa 20 workspace, cái thứ 21 bị từ chối", async () => {
    const svc = workspacesSvc();
    for (let i = 0; i < MAX_WORKSPACES_PER_USER; i++)
      await svc.create({ actorId: "u1", name: `WS ${i}` });
    await expect(
      svc.create({ actorId: "u1", name: "WS 21" }),
    ).rejects.toMatchObject({ reason: "workspace_limit" });
    expect(await svc.listForUser("u1")).toHaveLength(20);
    // người khác không bị ảnh hưởng
    await expect(
      svc.create({ actorId: "u2", name: "Của u2" }),
    ).resolves.toMatchObject({ role: "owner" });
  });
});

describe("F-001 giới hạn đăng nhập sai theo tài khoản", () => {
  const wrong = (email: string) => signIn(email, "sai-mat-khau-123");

  it("F-001/AC-04: lần sai thứ 5 mở khoá chờ; kể cả mật khẩu đúng cũng nhận 429 TOO_MANY_ATTEMPTS; hết chờ thì vào được và bộ đếm về 0", async () => {
    await signUp();
    for (let i = 0; i < 4; i++) {
      await expect(wrong("lan@example.com")).rejects.toMatchObject({
        body: { code: "INVALID_EMAIL_OR_PASSWORD" },
      });
    }
    // 4 lần sai đầu chưa khoá: lần thứ 5 vẫn là 401, rồi mới bị khoá
    await expect(wrong("lan@example.com")).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(signIn("lan@example.com", PASSWORD)).rejects.toMatchObject({
      statusCode: 429,
      body: { code: "TOO_MANY_ATTEMPTS" },
    });
    // khoá một email không ảnh hưởng email khác
    await signUp("khac@example.com");
    await expect(signIn("khac@example.com", PASSWORD)).resolves.toBeDefined();

    await new Promise((r) => setTimeout(r, 1300)); // thời gian chờ đầu tiên là 1 giây
    await expect(signIn("lan@example.com", PASSWORD)).resolves.toBeDefined();
    const rows = await t.db.select().from(loginThrottle);
    expect(rows.every((r) => r.failures === 0)).toBe(true);
    // bộ đếm về 0 nên lại có 4 lần sai miễn phí
    for (let i = 0; i < 4; i++) await wrong("lan@example.com").catch(() => {});
    await expect(signIn("lan@example.com", PASSWORD)).resolves.toBeDefined();
  });

  it("F-001/AC-04: thời gian chờ tăng gấp đôi (1, 2, 4...) và có trần 900 giây", async () => {
    expect([5, 6, 7, 8].map(lockSeconds)).toEqual([1, 2, 4, 8]);
    expect([0, 1, 2, 3, 4].map(lockSeconds)).toEqual([0, 0, 0, 0, 0]);
    expect(lockSeconds(100)).toBe(900);

    await signUp();
    for (let i = 0; i < 5; i++) await wrong("lan@example.com").catch(() => {});
    const [first] = await t.db.select().from(loginThrottle);
    expect(first?.failures).toBe(5);
    expect(first!.lockedUntil!.getTime() - first!.updatedAt.getTime()).toBe(
      1000,
    );
    // lần sai tiếp theo (sau khi hết chờ) gấp đôi
    await t.client.query(
      `update login_throttle set locked_until = now() - interval '1 second'`,
    );
    await wrong("lan@example.com").catch(() => {});
    const [second] = await t.db.select().from(loginThrottle);
    expect(second?.failures).toBe(6);
    expect(second!.lockedUntil!.getTime() - second!.updatedAt.getTime()).toBe(
      2000,
    );
    // trần 15 phút, không khoá vĩnh viễn
    await t.client.query(
      `update login_throttle set failures = 30, locked_until = now() - interval '1 second'`,
    );
    await wrong("lan@example.com").catch(() => {});
    const [capped] = await t.db.select().from(loginThrottle);
    expect(capped!.lockedUntil!.getTime() - capped!.updatedAt.getTime()).toBe(
      900_000,
    );
  });

  it("F-001/AC-04: email không tồn tại cho cùng chuỗi phản hồi, kể cả khi bị khoá", async () => {
    const results: unknown[] = [];
    for (let i = 0; i < 5; i++)
      results.push(await wrong("ghost@example.com").catch((e: unknown) => e));
    for (const r of results)
      expect(r).toMatchObject({
        statusCode: 401,
        body: { code: "INVALID_EMAIL_OR_PASSWORD" },
      });
    await expect(wrong("ghost@example.com")).rejects.toMatchObject({
      statusCode: 429,
      body: { code: "TOO_MANY_ATTEMPTS" },
    });
  });

  it("F-001/AC-04: bộ đếm không mất cập nhật khi sai song song; email khác hoa/thường dùng chung bộ đếm", async () => {
    await signUp();
    await Promise.all(
      [1, 2, 3, 4].map(() => wrong("lan@example.com").catch(() => {})),
    );
    const rows = await t.db.select().from(loginThrottle);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.failures).toBe(4);
    expect(rows[0]?.lockedUntil).toBeNull();
    // email khác hoa/thường vào cùng một bộ đếm (lần thứ 5 -> khoá)
    await wrong("LAN@Example.com").catch(() => {});
    await expect(signIn("lan@example.com", PASSWORD)).rejects.toMatchObject({
      statusCode: 429,
    });
    // không lưu email rõ trong khoá
    const [row] = await t.db.select().from(loginThrottle);
    expect(row?.keyHash).not.toContain("lan@example.com");
  });

  it("F-001/AC-04: bộ đếm sai cũ hơn 24 giờ bắt đầu lại từ 1", async () => {
    await signUp();
    for (let i = 0; i < 4; i++) await wrong("lan@example.com").catch(() => {});
    await t.client.query(
      `update login_throttle set updated_at = now() - interval '25 hours'`,
    );
    await wrong("lan@example.com").catch(() => {});
    const [row] = await t.db.select().from(loginThrottle);
    expect(row?.failures).toBe(1);
    expect(row?.lockedUntil).toBeNull();
    await expect(signIn("lan@example.com", PASSWORD)).resolves.toBeDefined();
  });

  it("F-001/AC-04: mỗi IP có hạn mức theo phút, vượt thì 429", async () => {
    const limited = createAuth({
      db: t.db,
      secret: SECRET,
      baseURL: BASE_URL,
      rateLimitPerMinute: 3,
    });
    const post = (ip: string, email: string) =>
      limited.handler(
        new Request(`${BASE_URL}/api/auth/sign-in/email`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: BASE_URL,
            "x-forwarded-for": ip,
          },
          body: JSON.stringify({ email, password: "sai-mat-khau-123" }),
        }),
      );
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++)
      statuses.push((await post("203.0.113.9", `u${i}@example.com`)).status);
    expect(statuses.slice(0, 3).every((s) => s !== 429)).toBe(true);
    expect(statuses[3]).toBe(429);
    // IP khác không bị ảnh hưởng
    expect((await post("203.0.113.77", "x@example.com")).status).not.toBe(429);
  });
});

describe("F-001 cách ly giữa các workspace", () => {
  async function world() {
    const box = createSecretBox(Buffer.alloc(32, 9).toString("base64"));
    const registry = createRegistry();
    const demo = createDemoProvider({
      now: () => new Date("2026-11-24T08:00:00Z"),
    });
    registry.register(demo);
    const resolveProvider = (id: string) => (id === "demo" ? demo : undefined);
    const conns = createConnectionService({ db: t.db, box, registry });
    const accts = createAccountService({ db: t.db, registry });
    const inbox = createInboxService({ db: t.db, box, resolveProvider });
    const posts = createPostService({ db: t.db, box, resolveProvider });
    const ws = workspacesSvc();
    const A = await ws.create({ actorId: "owner-a", name: "A" });
    const B = await ws.create({ actorId: "owner-b", name: "B" });
    const connA = await conns.create({
      actorId: "owner-a",
      workspaceId: A.id,
      provider: "demo",
      label: "kết nối A",
      credentials: "khoa-cua-A",
    });
    const accA = await accts.add({
      actorId: "owner-a",
      workspaceId: A.id,
      connectionId: connA.id,
      platform: "facebook",
      externalId: "fb-a",
      displayName: "Trang A",
    });
    await inbox.sync({
      actorId: "owner-a",
      workspaceId: A.id,
      accountId: accA.id,
    });
    const { items } = await inbox.list({
      actorId: "owner-a",
      workspaceId: A.id,
    });
    return { conns, accts, inbox, posts, A, B, connA, accA, itemA: items[0]! };
  }

  it("F-001/AC-05: dùng ID tài nguyên của A trong workspace B trả NotFound và dữ liệu A không đổi", async () => {
    const w = await world();
    const b = "owner-b";
    await expectRejects(
      w.conns.remove({
        actorId: b,
        workspaceId: w.B.id,
        connectionId: w.connA.id,
      }),
      NotFoundError,
    );
    await expectRejects(
      w.conns.setWebhookSecret({
        actorId: b,
        workspaceId: w.B.id,
        connectionId: w.connA.id,
        secret: "mot-secret-du-dai-123",
      }),
      NotFoundError,
    );
    await expectRejects(
      w.conns.credentialsFor({
        workspaceId: w.B.id,
        connectionId: w.connA.id,
      }),
      NotFoundError,
    );
    await expectRejects(
      w.accts.add({
        actorId: b,
        workspaceId: w.B.id,
        connectionId: w.connA.id,
        platform: "facebook",
        externalId: "x",
        displayName: "x",
      }),
      NotFoundError,
    );
    await expectRejects(
      w.accts.remove({
        actorId: b,
        workspaceId: w.B.id,
        accountId: w.accA.id,
      }),
      NotFoundError,
    );
    await expectRejects(
      w.inbox.sync({
        actorId: b,
        workspaceId: w.B.id,
        accountId: w.accA.id,
      }),
      NotFoundError,
    );
    await expectRejects(
      w.inbox.setStatus({
        actorId: b,
        workspaceId: w.B.id,
        itemId: w.itemA.id,
        status: "handled",
      }),
      NotFoundError,
    );
    await expectRejects(
      w.posts.schedule({
        actorId: b,
        workspaceId: w.B.id,
        accountId: w.accA.id,
        text: "bài của B",
        idempotencyKey: "k-1",
      }),
      NotFoundError,
    );

    // dữ liệu A không đổi
    const conns = await t.db.select().from(providerConnections);
    expect(conns).toHaveLength(1);
    expect(conns[0]?.webhookSecretEnc).toBeNull();
    expect(await t.db.select().from(socialAccounts)).toHaveLength(1);
    const [item] = await t.db
      .select()
      .from(inboxItems)
      .where(eq(inboxItems.id, w.itemA.id));
    expect(item?.status).toBe("open");
  });

  it("F-001/AC-05: gọi thẳng vào workspace A bằng người của B trả Forbidden ở dịch vụ", async () => {
    const w = await world();
    const b = "owner-b";
    await expectRejects(
      w.conns.list({ actorId: b, workspaceId: w.A.id }),
      ForbiddenError,
    );
    await expectRejects(
      w.accts.list({ actorId: b, workspaceId: w.A.id }),
      ForbiddenError,
    );
    await expectRejects(
      w.inbox.list({ actorId: b, workspaceId: w.A.id }),
      ForbiddenError,
    );
    await expectRejects(
      w.inbox.setStatus({
        actorId: b,
        workspaceId: w.A.id,
        itemId: w.itemA.id,
        status: "handled",
      }),
      ForbiddenError,
    );
    await expectRejects(
      w.conns.remove({
        actorId: b,
        workspaceId: w.A.id,
        connectionId: w.connA.id,
      }),
      ForbiddenError,
    );
    await expectRejects(
      w.posts.schedule({
        actorId: b,
        workspaceId: w.A.id,
        accountId: w.accA.id,
        text: "xâm nhập",
        idempotencyKey: "k-2",
      }),
      ForbiddenError,
    );
    expect(await t.db.select().from(providerConnections)).toHaveLength(1);
    expect(await getRole(t.db, w.A.id, b)).toBeNull();
  });

  it("F-001/AC-05: ID không phải UUID cũng chỉ là NotFound", async () => {
    const w = await world();
    await expectRejects(
      w.conns.remove({
        actorId: "owner-a",
        workspaceId: w.A.id,
        connectionId: "khong-phai-uuid",
      }),
      NotFoundError,
    );
    await expectRejects(
      w.inbox.setStatus({
        actorId: "owner-a",
        workspaceId: w.A.id,
        itemId: "khong-phai-uuid",
        status: "handled",
      }),
      NotFoundError,
    );
  });
});

describe("F-001 bảng quyền can(role, action)", () => {
  const MEMBER_ONLY: Action[] = [
    "inbox.read",
    "inbox.reply",
    "posts.publish",
    "evidence.read",
  ];
  const ADMIN_EXTRA: Action[] = [
    "connections.manage",
    "members.invite",
    "members.remove",
  ];
  const OWNER_ONLY: Action[] = [
    "members.changeRole",
    "workspace.delete",
    "workspace.settings",
  ];

  it("F-001/AC-06: người ngoài (null) không làm được gì", () => {
    for (const a of ACTIONS) expect(can(null, a)).toBe(false);
  });

  it("F-001/AC-06: member chỉ đọc/trả lời hộp thư, đăng bài, đọc kho bằng chứng", () => {
    for (const a of MEMBER_ONLY) expect(can("member", a)).toBe(true);
    for (const a of [...ADMIN_EXTRA, ...OWNER_ONLY])
      expect(can("member", a)).toBe(false);
  });

  it("F-001/AC-06: admin có quyền của member và thêm quản lý kết nối, thành viên; không có quyền chỉ của owner", () => {
    for (const a of [...MEMBER_ONLY, ...ADMIN_EXTRA])
      expect(can("admin", a)).toBe(true);
    for (const a of OWNER_ONLY) expect(can("admin", a)).toBe(false);
  });

  it("F-001/AC-06: chỉ owner đổi vai trò, xoá workspace, đổi cấu hình; owner làm được mọi hành động", () => {
    for (const a of OWNER_ONLY) expect(can("owner", a)).toBe(true);
    for (const a of ACTIONS) expect(can("owner", a)).toBe(true);
  });
});

describe("F-001 thành viên và owner cuối cùng", () => {
  const ownerCount = async (wsId: string) =>
    (
      await t.db.select().from(members).where(eq(members.workspaceId, wsId))
    ).filter((m) => m.role === "owner").length;

  async function wsWithOwners(n: number, name = "Nhóm") {
    const ws = await workspacesSvc().create({ actorId: "o1", name });
    for (let i = 2; i <= n; i++)
      await addMember(t.db, {
        actorId: "o1",
        workspaceId: ws.id,
        userId: `o${i}`,
        role: "owner",
      });
    return ws;
  }

  it("F-001/AC-07: owner duy nhất không tự hạ vai trò hay tự rời được (last_owner)", async () => {
    const ws = await wsWithOwners(1);
    const demote = changeRole(t.db, {
      actorId: "o1",
      workspaceId: ws.id,
      targetUserId: "o1",
      newRole: "admin",
    });
    await expect(demote).rejects.toBeInstanceOf(ConflictError);
    await expect(demote).rejects.toMatchObject({ reason: "last_owner" });
    await expect(
      removeMember(t.db, {
        actorId: "o1",
        workspaceId: ws.id,
        targetUserId: "o1",
      }),
    ).rejects.toMatchObject({ reason: "last_owner" });
    expect(await ownerCount(ws.id)).toBe(1);
  });

  it("F-001/AC-07: có hai owner thì một người rời được, người còn lại thành owner cuối bị bảo vệ", async () => {
    const ws = await wsWithOwners(2);
    await removeMember(t.db, {
      actorId: "o2",
      workspaceId: ws.id,
      targetUserId: "o2",
    });
    expect(await getRole(t.db, ws.id, "o2")).toBeNull();
    await expect(
      removeMember(t.db, {
        actorId: "o1",
        workspaceId: ws.id,
        targetUserId: "o1",
      }),
    ).rejects.toMatchObject({ reason: "last_owner" });
    expect(await ownerCount(ws.id)).toBe(1);
  });

  it("F-001/AC-07: hai owner cùng hạ nhau song song chỉ một thành công, luôn còn đúng một owner", async () => {
    for (let round = 0; round < 5; round++) {
      const ws = await wsWithOwners(2, `Đua ${round}`);
      const results = await Promise.allSettled([
        changeRole(t.db, {
          actorId: "o1",
          workspaceId: ws.id,
          targetUserId: "o2",
          newRole: "member",
        }),
        changeRole(t.db, {
          actorId: "o2",
          workspaceId: ws.id,
          targetUserId: "o1",
          newRole: "member",
        }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await ownerCount(ws.id)).toBe(1);
    }
  });

  it("F-001/AC-07: hai owner cùng rời song song chỉ một thành công, luôn còn một owner", async () => {
    for (let round = 0; round < 5; round++) {
      const ws = await wsWithOwners(2, `Rời ${round}`);
      const results = await Promise.allSettled([
        removeMember(t.db, {
          actorId: "o1",
          workspaceId: ws.id,
          targetUserId: "o1",
        }),
        removeMember(t.db, {
          actorId: "o2",
          workspaceId: ws.id,
          targetUserId: "o2",
        }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await ownerCount(ws.id)).toBe(1);
    }
  });

  it("F-001/AC-08: admin không thêm admin/owner, không đổi vai trò, không xoá admin/owner khác; dữ liệu không đổi", async () => {
    const ws = await wsWithOwners(1);
    const base = { workspaceId: ws.id };
    await addMember(t.db, {
      ...base,
      actorId: "o1",
      userId: "a1",
      role: "admin",
    });
    await addMember(t.db, {
      ...base,
      actorId: "o1",
      userId: "a2",
      role: "admin",
    });
    await addMember(t.db, {
      ...base,
      actorId: "o1",
      userId: "m1",
      role: "member",
    });

    await expectRejects(
      addMember(t.db, { ...base, actorId: "a1", userId: "x1", role: "admin" }),
      ForbiddenError,
    );
    await expectRejects(
      addMember(t.db, { ...base, actorId: "a1", userId: "x2", role: "owner" }),
      ForbiddenError,
    );
    await expectRejects(
      changeRole(t.db, {
        ...base,
        actorId: "a1",
        targetUserId: "m1",
        newRole: "admin",
      }),
      ForbiddenError,
    );
    await expectRejects(
      changeRole(t.db, {
        ...base,
        actorId: "a1",
        targetUserId: "a2",
        newRole: "member",
      }),
      ForbiddenError,
    );
    await expectRejects(
      removeMember(t.db, { ...base, actorId: "a1", targetUserId: "a2" }),
      ForbiddenError,
    );
    await expectRejects(
      removeMember(t.db, { ...base, actorId: "a1", targetUserId: "o1" }),
      ForbiddenError,
    );

    expect(await getRole(t.db, ws.id, "x1")).toBeNull();
    expect(await getRole(t.db, ws.id, "x2")).toBeNull();
    expect(await getRole(t.db, ws.id, "m1")).toBe("member");
    expect(await getRole(t.db, ws.id, "a2")).toBe("admin");
    expect(await getRole(t.db, ws.id, "o1")).toBe("owner");

    // admin vẫn thêm và xoá được member
    await addMember(t.db, {
      ...base,
      actorId: "a1",
      userId: "m2",
      role: "member",
    });
    expect(await getRole(t.db, ws.id, "m2")).toBe("member");
    await removeMember(t.db, { ...base, actorId: "a1", targetUserId: "m2" });
    expect(await getRole(t.db, ws.id, "m2")).toBeNull();
  });

  it("F-001/AC-08: member và người ngoài không quản lý được thành viên", async () => {
    const ws = await wsWithOwners(1);
    const base = { workspaceId: ws.id };
    await addMember(t.db, {
      ...base,
      actorId: "o1",
      userId: "m1",
      role: "member",
    });
    await expectRejects(
      addMember(t.db, { ...base, actorId: "m1", userId: "x", role: "member" }),
      ForbiddenError,
    );
    await expectRejects(
      removeMember(t.db, { ...base, actorId: "outsider", targetUserId: "m1" }),
      ForbiddenError,
    );
    await expectRejects(
      changeRole(t.db, {
        ...base,
        actorId: "m1",
        targetUserId: "o1",
        newRole: "member",
      }),
      ForbiddenError,
    );
    expect(await getRole(t.db, ws.id, "o1")).toBe("owner");
    expect(await getRole(t.db, ws.id, "m1")).toBe("member");
  });
});

describe("F-001 phiên", () => {
  it("F-001/AC-09: đăng xuất thì cookie cũ không còn phiên", async () => {
    await signUp();
    const headers = await login();
    const before = await auth.api.getSession({ headers });
    expect(before?.user.email).toBe("lan@example.com");
    await auth.api.signOut({ headers });
    expect(await auth.api.getSession({ headers })).toBeNull();
    expect(await t.db.select().from(session)).toHaveLength(0);
  });

  it("F-001/AC-09: phiên hết hạn không dùng được", async () => {
    await signUp();
    const headers = await login();
    expect(await auth.api.getSession({ headers })).not.toBeNull();
    await t.db
      .update(session)
      .set({ expiresAt: new Date(Date.now() - 60_000) });
    expect(await auth.api.getSession({ headers })).toBeNull();
  });

  it("F-001/AC-09: người bị gỡ khỏi workspace bị từ chối ngay ở lần gọi kế tiếp", async () => {
    const owner = (await signUp("chu@example.com")).user.id;
    const staff = (await signUp("nv@example.com")).user.id;
    const ws = await workspacesSvc().create({
      actorId: owner,
      name: "Cửa hàng",
    });
    await addMember(t.db, {
      actorId: owner,
      workspaceId: ws.id,
      userId: staff,
      role: "member",
    });
    const registry = createRegistry();
    registry.register(createDemoProvider());
    const conns = createConnectionService({
      db: t.db,
      box: createSecretBox(Buffer.alloc(32, 3).toString("base64")),
      registry,
    });
    const staffHeaders = await login("nv@example.com");
    expect(
      (await auth.api.getSession({ headers: staffHeaders }))?.user.id,
    ).toBe(staff);
    await expect(
      conns.list({ actorId: staff, workspaceId: ws.id }),
    ).resolves.toEqual([]);

    await removeMember(t.db, {
      actorId: owner,
      workspaceId: ws.id,
      targetUserId: staff,
    });
    await expectRejects(
      conns.list({ actorId: staff, workspaceId: ws.id }),
      ForbiddenError,
    );
    expect(await getRole(t.db, ws.id, staff)).toBeNull();
  });
});
