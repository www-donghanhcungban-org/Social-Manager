import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAuth } from "@/src/auth/auth";
import type { Db } from "@/src/auth/members";
import { loginThrottle, session } from "@/src/db/schema";

import { createTestDb } from "../../db/helpers";
import { AUTH_SECRET, PASSWORD } from "./world";

/**
 * Dò mật khẩu qua HANDLER HTTP THẬT của Better Auth (`POST /api/auth/sign-in/email`): giới hạn theo IP (bộ nhớ) và khoá
 * theo tài khoản (bảng `login_throttle` trên PGlite với migration thật). Mỗi request mang IP riêng qua header proxy đã cấu
 * hình, nên giới hạn theo IP không che mất khoá theo tài khoản — đúng cách kẻ tấn công có nhiều IP làm.
 *
 * Đồng hồ CSDL đóng băng: khoá tính bằng `now()` của Postgres, nên test đặt một hàm `public.now()` đọc bảng `test_clock`
 * và đưa `public` lên trước `pg_catalog` trong `search_path`. Nhờ vậy "hết thời hạn khoá" là tua đồng hồ, không phải ngủ,
 * và máy chậm không làm khoá 1 giây hết hạn giữa chừng.
 */
const hashing = vi.hoisted(() => ({ hash: 0, verify: 0 }));
vi.mock("@/src/auth/password", async (orig) => {
  const real = await orig<typeof import("@/src/auth/password")>();
  return {
    hashPassword: (p: string) => {
      hashing.hash++;
      return real.hashPassword(p);
    },
    verifyPassword: (a: { hash: string; password: string }) => {
      hashing.verify++;
      return real.verifyPassword(a);
    },
  };
});

const EMAIL = "lan@example.com";
const WRONG = "sai-mat-khau-12345";
const ORIGIN = "http://localhost:3000";

let t: Awaited<ReturnType<typeof createTestDb>>;
let auth: ReturnType<typeof createAuth>;
let ipSeq = 0;
/** Mỗi lần gọi một IP mới (TEST-NET-3): giới hạn theo IP không bao giờ là thứ chặn trong các test này. */
const freshIp = () => `203.0.113.${++ipSeq % 250}`;

async function signIn(email: string, password: string, ip = freshIp()) {
  const res = await auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "x-test-ip": ip,
      },
      body: JSON.stringify({ email, password }),
    }),
  );
  const text = await res.text();
  let code: string | undefined;
  try {
    code = (JSON.parse(text) as { code?: string }).code;
  } catch {
    code = undefined;
  }
  return {
    status: res.status,
    code,
    text,
    cookies: res.headers.getSetCookie().length,
  };
}

const tick = (seconds: number) =>
  t.client.query(
    `update test_clock set t = t + make_interval(secs => $1::double precision)`,
    [seconds],
  );

beforeEach(async () => {
  t = await createTestDb();
  await t.client.exec(`
    create table test_clock (t timestamptz not null);
    insert into test_clock values ('2026-11-24T00:00:00Z');
    create function public.now() returns timestamptz language sql stable as $$ select t from test_clock $$;
    set search_path = public, pg_catalog;
  `);
  auth = createAuth({
    db: t.db as unknown as Db,
    secret: AUTH_SECRET,
    baseURL: ORIGIN,
    clientIpHeader: "x-test-ip",
  });
  await auth.api.signUpEmail({
    body: { name: "Lan", email: EMAIL, password: PASSWORD },
  });
  hashing.hash = 0;
  hashing.verify = 0;
});
afterEach(async () => {
  await t.client.close();
});

describe("tấn công dò mật khẩu: khoá theo tài khoản (BE-AUTH-003)", () => {
  it("đồng hồ CSDL của test thật sự đóng băng và tua được (điều kiện để các test dưới có nghĩa)", async () => {
    const at = async () =>
      (await t.client.query<{ n: string }>(`select now()::text as n`)).rows[0]!
        .n;
    expect(await at()).toBe("2026-11-24 00:00:00+00");
    await tick(2);
    expect(await at()).toBe("2026-11-24 00:00:02+00");
  });

  it("5 lần sai từ 5 IP khác nhau trả 401; lần thứ 6 bị 429 kể cả khi đúng mật khẩu, không cấp phiên", async () => {
    const wrong = [];
    for (let i = 0; i < 5; i++) wrong.push(await signIn(EMAIL, WRONG));
    expect(wrong.map((r) => [r.status, r.code])).toEqual(
      Array.from({ length: 5 }, () => [401, "INVALID_EMAIL_OR_PASSWORD"]),
    );
    const sixth = await signIn(EMAIL, PASSWORD);
    expect(sixth).toMatchObject({
      status: 429,
      code: "TOO_MANY_ATTEMPTS",
      cookies: 0,
    });
    expect(await t.db.select().from(session)).toHaveLength(0);
    // Bị khoá thì không tốn một lần băm: không có "đường đo thời gian" xác nhận mật khẩu đúng trong lúc khoá.
    expect(hashing.verify).toBe(5);
  });

  it("hết thời hạn khoá (tua đồng hồ CSDL) thì mật khẩu đúng đăng nhập được và bộ đếm về 0; chưa hết thì vẫn 429", async () => {
    for (let i = 0; i < 5; i++) await signIn(EMAIL, WRONG);
    await tick(0.5);
    expect((await signIn(EMAIL, PASSWORD)).status).toBe(429);
    await tick(1);
    const ok = await signIn(EMAIL, PASSWORD);
    expect(ok.status).toBe(200);
    expect(ok.cookies).toBeGreaterThan(0);
    expect(await t.db.select().from(loginThrottle)).toHaveLength(0);
  });

  it("sai tiếp sau khi hết khoá thì khoá lại lâu hơn (luỹ tiến 1 → 2 giây)", async () => {
    for (let i = 0; i < 5; i++) await signIn(EMAIL, WRONG);
    await tick(1.5);
    expect((await signIn(EMAIL, WRONG)).status).toBe(401); // lần 6: khoá 2 giây
    await tick(1.5);
    expect((await signIn(EMAIL, PASSWORD)).status).toBe(429);
    await tick(1);
    expect((await signIn(EMAIL, PASSWORD)).status).toBe(200);
  });

  it("dò song song từ 20 IP cùng lúc: không quá 5 lần đoán được kiểm mật khẩu trước khi khoá", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => signIn(EMAIL, WRONG)),
    );
    const guessed = results.filter((r) => r.status === 401).length;
    const locked = results.filter((r) => r.status === 429).length;
    expect(guessed + locked).toBe(20);
    expect(guessed).toBeLessThanOrEqual(5);
    expect(hashing.verify).toBeLessThanOrEqual(5);
    // Sau đợt song song tài khoản đang khoá: mật khẩu đúng cũng bị từ chối.
    expect((await signIn(EMAIL, PASSWORD)).status).toBe(429);
  });
});

describe("tấn công dò email đã đăng ký (user enumeration)", () => {
  it("email không tồn tại và sai mật khẩu cho cùng mã trạng thái, cùng thân phản hồi, không cookie", async () => {
    const wrongPassword = await signIn(EMAIL, WRONG);
    const noUser = await signIn("khong-co@example.com", WRONG);
    expect(wrongPassword).toMatchObject({ status: 401, cookies: 0 });
    expect(noUser).toEqual(wrongPassword);
  });

  it("email không tồn tại vẫn tốn một lần băm Argon2 (không lộ qua thời gian phản hồi rút ngắn)", async () => {
    await signIn("khong-co@example.com", WRONG);
    expect(hashing.hash + hashing.verify).toBeGreaterThanOrEqual(1);
  });

  it("chuỗi phản hồi khi dò đến khoá giống hệt nhau giữa email có thật và email không tồn tại", async () => {
    const run = async (email: string) => {
      const out = [];
      for (let i = 0; i < 7; i++) out.push(await signIn(email, WRONG));
      return out.map((r) => [r.status, r.code, r.text]);
    };
    const real = await run(EMAIL);
    const fake = await run("khong-co@example.com");
    expect(real.map((r) => r[0])).toEqual([401, 401, 401, 401, 401, 429, 429]);
    expect(fake).toEqual(real);
  });
});
