import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loginThrottle } from "@/src/db/schema";
import { createLoginThrottle, lockSeconds } from "@/src/auth/throttle";

import { createTestDb } from "../db/helpers";

describe("lockSeconds (trì hoãn luỹ tiến, BE-AUTH-003)", () => {
  it("không khoá khi còn dưới ngưỡng, rồi tăng gấp đôi và có trần [F-001/AC-04]", () => {
    expect([1, 2, 3, 4].map(lockSeconds)).toEqual([0, 0, 0, 0]);
    expect([5, 6, 7, 8].map(lockSeconds)).toEqual([1, 2, 4, 8]);
    expect(lockSeconds(20)).toBe(900);
    expect(lockSeconds(100)).toBe(900);
    expect(lockSeconds(10_000)).toBe(900); // không tràn số mũ
  });
});

let t: Awaited<ReturnType<typeof createTestDb>>;
const SECRET = "k".repeat(40);
const th = () => createLoginThrottle({ db: t.db, secret: SECRET });

beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.client.close();
});

describe("createLoginThrottle", () => {
  it("20 lần sai liên tiếp → bị chặn; email chưa đăng ký bị đối xử giống hệt [F-001/AC-04]", async () => {
    for (const email of ["co@example.com", "khong-co@example.com"]) {
      for (let i = 0; i < 20; i++) await th().recordFailure(email);
      expect(await th().isLocked(email)).toBe(true);
    }
  });

  it("dưới ngưỡng thì chưa khoá", async () => {
    for (let i = 0; i < 4; i++) await th().recordFailure("a@example.com");
    expect(await th().isLocked("a@example.com")).toBe(false);
  });

  it("đăng nhập đúng xoá bộ đếm", async () => {
    for (let i = 0; i < 20; i++) await th().recordFailure("a@example.com");
    await th().recordSuccess("a@example.com");
    expect(await th().isLocked("a@example.com")).toBe(false);
    expect(await t.db.select().from(loginThrottle)).toHaveLength(0);
  });

  it("hết thời gian khoá thì thử lại được; sai tiếp thì khoá lại lâu hơn", async () => {
    for (let i = 0; i < 6; i++) await th().recordFailure("a@example.com");
    await t.db
      .update(loginThrottle)
      .set({ lockedUntil: new Date(Date.now() - 1000) });
    expect(await th().isLocked("a@example.com")).toBe(false);
    await th().recordFailure("a@example.com");
    expect(await th().isLocked("a@example.com")).toBe(true);
  });

  it("email chuẩn hoá: hoa/thường, khoảng trắng và NFC/NFD dùng chung một bộ đếm", async () => {
    await th().recordFailure("Lan@Example.com");
    await th().recordFailure("  lan@example.com ");
    const rows = await t.db.select().from(loginThrottle);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.failures).toBe(2);
    await th().recordFailure("é@example.com".normalize("NFD"));
    await th().recordFailure("é@example.com".normalize("NFC"));
    expect(await t.db.select().from(loginThrottle)).toHaveLength(2);
  });

  it("không lưu email rõ trong DB", async () => {
    await th().recordFailure("lan@example.com");
    const [row] = await t.db.select().from(loginThrottle);
    expect(row!.keyHash).not.toContain("lan");
    expect(row!.keyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("nhiều lần sai song song vẫn đếm đủ (không mất cập nhật) [F-001/AC-04]", async () => {
    await Promise.all(
      Array.from({ length: 10 }, () => th().recordFailure("p@example.com")),
    );
    const [row] = await t.db.select().from(loginThrottle);
    expect(row!.failures).toBe(10);
  });

  it("tryAttempt giữ chỗ nguyên tử: 20 lần thử song song chỉ 5 lần được phép, còn lại bị từ chối vì đã khoá", async () => {
    const allowed = await Promise.all(
      Array.from({ length: 20 }, () => th().tryAttempt("p@example.com")),
    );
    expect(allowed.filter(Boolean)).toHaveLength(5);
    const [row] = await t.db.select().from(loginThrottle);
    expect(row!.failures).toBe(5); // lần bị từ chối không tăng đếm, không kéo dài khoá
    expect(await th().isLocked("p@example.com")).toBe(true);
  });

  it("tryAttempt: lần đầu (chưa có dòng) được phép; hết hạn khoá thì được phép lại và khoá lâu hơn", async () => {
    expect(await th().tryAttempt("a@example.com")).toBe(true);
    for (let i = 0; i < 4; i++)
      expect(await th().tryAttempt("a@example.com")).toBe(true);
    expect(await th().tryAttempt("a@example.com")).toBe(false);
    await t.db
      .update(loginThrottle)
      .set({ lockedUntil: new Date(Date.now() - 1000) });
    expect(await th().tryAttempt("a@example.com")).toBe(true);
    const [row] = await t.db.select().from(loginThrottle);
    expect(row!.failures).toBe(6);
    expect(await th().isLocked("a@example.com")).toBe(true);
  });

  it("bộ đếm cũ hơn 24 giờ bắt đầu lại từ đầu [F-001/AC-04]", async () => {
    for (let i = 0; i < 20; i++) await th().recordFailure("a@example.com");
    await t.db.update(loginThrottle).set({
      updatedAt: new Date(Date.now() - 25 * 3600 * 1000),
      lockedUntil: new Date(Date.now() - 1000),
    });
    await th().recordFailure("a@example.com");
    const [row] = await t.db.select().from(loginThrottle);
    expect(row!.failures).toBe(1);
    expect(await th().isLocked("a@example.com")).toBe(false);
  });
});
