import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAuth } from "@/src/auth/auth";
import { session, user } from "@/src/db/schema";

import { createTestDb } from "../db/helpers";

const SECRET = "x".repeat(48);
const PASSWORD = "mat-khau-du-dai-123";

let t: Awaited<ReturnType<typeof createTestDb>>;
let auth: ReturnType<typeof createAuth>;

beforeEach(async () => {
  t = await createTestDb();
  auth = createAuth({
    db: t.db,
    secret: SECRET,
    baseURL: "http://localhost:3000",
  });
});
afterEach(async () => {
  await t.client.close();
});

const signUp = (email = "lan@example.com", password = PASSWORD) =>
  auth.api.signUpEmail({ body: { name: "Lan", email, password } });

/** Đăng nhập và lấy cookie phiên để dùng cho getSession. */
async function login(email = "lan@example.com", password = PASSWORD) {
  const { headers } = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = (headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
  return new Headers({ cookie });
}

describe("đăng ký", () => {
  it("tạo người dùng và lưu mật khẩu đã băm, không lưu mật khẩu rõ", async () => {
    await signUp();
    const rows = await t.client.query<{ password: string }>(
      `select password from account where provider_id = 'credential'`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.password).toBeTruthy();
    expect(rows.rows[0]?.password).not.toContain(PASSWORD);
  });

  it("đăng ký trùng email (kể cả khác hoa/thường) không tạo thêm người dùng, không đổi mật khẩu", async () => {
    await signUp("lan@example.com");
    await signUp("lan@example.com", "mat-khau-khac-456789").catch(() => {});
    await signUp("LAN@Example.com", "mat-khau-khac-456789").catch(() => {});
    expect(await t.db.select().from(user)).toHaveLength(1);
    // mật khẩu cũ vẫn dùng được, mật khẩu của lần đăng ký trùng thì không
    await expect(login("lan@example.com", PASSWORD)).resolves.toBeInstanceOf(
      Headers,
    );
    await expect(
      login("lan@example.com", "mat-khau-khac-456789"),
    ).rejects.toMatchObject({ body: { code: "INVALID_EMAIL_OR_PASSWORD" } });
  });

  it("không lộ email đã đăng ký: email mới và email đã có cho phản hồi giống nhau, đều không cấp phiên", async () => {
    await signUp("lan@example.com");
    const existing = await signUp("lan@example.com").catch((e: unknown) => e);
    const fresh = await signUp("moi@example.com");
    expect(existing).not.toBeInstanceOf(Error);
    expect(fresh.token).toBeNull();
    expect((existing as { token: unknown }).token).toBeNull();
    expect(Object.keys(existing as object).sort()).toEqual(
      Object.keys(fresh).sort(),
    );
    expect(await t.db.select().from(session)).toHaveLength(0);
  });

  it("từ chối mật khẩu ngắn hơn 12 ký tự", async () => {
    await expect(signUp("a@example.com", "ngan-qua")).rejects.toMatchObject({
      body: { code: "PASSWORD_TOO_SHORT" },
    });
    expect(await t.db.select().from(user)).toHaveLength(0);
  });
});

describe("giới hạn tần suất đăng nhập (review 🟡 9)", () => {
  const signIn = (auth2: ReturnType<typeof createAuth>, ip: string) =>
    auth2.handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-ip": ip },
        body: JSON.stringify({
          email: "ai-do@example.com",
          password: "mat-khau-sai-123456",
        }),
      }),
    );

  it("quá hạn mức trong cửa sổ thì 429; mỗi IP một bộ đếm riêng; IP lấy từ header đã cấu hình", async () => {
    const limited = createAuth({
      db: t.db,
      secret: SECRET,
      baseURL: "http://localhost:3000",
      clientIpHeader: "x-test-ip",
      rateLimitPerMinute: 3,
    });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++)
      statuses.push((await signIn(limited, "203.0.113.1")).status);
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses.slice(3)).toEqual([429, 429]);
    // IP khác không bị ảnh hưởng
    expect((await signIn(limited, "203.0.113.2")).status).toBe(401);
  });
});

describe("đăng nhập và phiên", () => {
  it("đăng nhập đúng mật khẩu → có phiên dùng được", async () => {
    await signUp();
    const headers = await login();
    const s = await auth.api.getSession({ headers });
    expect(s?.user.email).toBe("lan@example.com");
  });

  it("sai mật khẩu và email không tồn tại cho cùng một phản hồi (không lộ email nào đã đăng ký)", async () => {
    await signUp();
    const wrongPassword = await auth.api
      .signInEmail({
        body: { email: "lan@example.com", password: "sai-mat-khau-123" },
      })
      .catch((e: unknown) => e);
    const noUser = await auth.api
      .signInEmail({
        body: { email: "khong-co@example.com", password: PASSWORD },
      })
      .catch((e: unknown) => e);
    const expected = {
      status: "UNAUTHORIZED",
      body: { code: "INVALID_EMAIL_OR_PASSWORD" },
    };
    expect(wrongPassword).toMatchObject(expected);
    expect(noUser).toMatchObject(expected);
    expect((wrongPassword as { body: unknown }).body).toEqual(
      (noUser as { body: unknown }).body,
    );
  });

  it("không có cookie thì không có phiên", async () => {
    expect(await auth.api.getSession({ headers: new Headers() })).toBeNull();
  });

  it("phiên hết hạn không còn dùng được", async () => {
    await signUp();
    const headers = await login();
    expect((await auth.api.getSession({ headers }))?.user.email).toBe(
      "lan@example.com",
    );
    await t.db
      .update(session)
      .set({ expiresAt: new Date(Date.now() - 60_000) });
    expect(await auth.api.getSession({ headers })).toBeNull();
  });

  it("đăng xuất xoá đúng phiên đang dùng, cookie cũ hết tác dụng", async () => {
    await signUp(); // tự đăng nhập: tạo phiên thứ nhất
    const headers = await login(); // phiên thứ hai
    const before = (await t.db.select().from(session)).length;
    await auth.api.signOut({ headers });
    expect(await auth.api.getSession({ headers })).toBeNull();
    expect(await t.db.select().from(session)).toHaveLength(before - 1);
  });
});

describe("cấu hình", () => {
  it("thiếu secret hoặc secret quá ngắn thì dừng, không chạy với giá trị mặc định", () => {
    for (const secret of ["", "ngan"]) {
      expect(() =>
        createAuth({ db: t.db, secret, baseURL: "http://localhost:3000" }),
      ).toThrow(/secret/i);
    }
  });
});
