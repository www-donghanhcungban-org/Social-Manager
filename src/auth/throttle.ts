import { createHmac } from "node:crypto";

import { eq, sql } from "drizzle-orm";

import { loginThrottle } from "../db/schema";
import type { Db } from "./members";

/** Số lần sai liên tiếp được phép trước khi bắt đầu trì hoãn. */
const FREE_FAILURES = 4;
const MAX_LOCK_SECONDS = 900;
const RESET_AFTER_HOURS = 24;

/**
 * Thời gian khoá (giây) sau `failures` lần sai liên tiếp: 0 đến lần thứ 4, rồi 1, 2, 4, 8… giây, trần
 * 15 phút. Trần thấp cố ý: kẻ tấn công có thể cố tình khoá một email, nên khoá không được kéo dài vô hạn;
 * dò mật khẩu bị hạn chế còn ≤ ~100 lần/giờ cho mỗi email.
 */
export function lockSeconds(failures: number): number {
  if (failures <= FREE_FAILURES) return 0;
  const exp = Math.min(failures - FREE_FAILURES - 1, 20); // chặn tràn số mũ
  return Math.min(2 ** exp, MAX_LOCK_SECONDS);
}

/**
 * Giới hạn đăng nhập thất bại theo TÀI KHOẢN, bổ sung cho giới hạn theo IP (BE-AUTH-003). Đếm cả email
 * chưa đăng ký và khoá theo cùng một cách, nên phản hồi không cho biết email nào tồn tại.
 */
export function createLoginThrottle({
  db,
  secret,
}: {
  db: Db;
  secret: string;
}) {
  const keyOf = (email: string) =>
    createHmac("sha256", secret)
      .update(email.normalize("NFC").trim().toLowerCase())
      .digest("hex");

  return {
    async isLocked(email: string): Promise<boolean> {
      const [row] = await db
        .select({ locked: sql<boolean>`${loginThrottle.lockedUntil} > now()` })
        .from(loginThrottle)
        .where(eq(loginThrottle.keyHash, keyOf(email)));
      return row?.locked === true;
    },

    /** Một câu lệnh nguyên tử: nhiều lần sai song song không làm mất lần đếm. */
    async recordFailure(email: string): Promise<void> {
      const stale = sql`${loginThrottle.updatedAt} < now() - make_interval(hours => ${RESET_AFTER_HOURS})`;
      const next = sql`(case when ${stale} then 1 else ${loginThrottle.failures} + 1 end)`;
      await db
        .insert(loginThrottle)
        .values({ keyHash: keyOf(email), failures: 1 })
        .onConflictDoUpdate({
          target: loginThrottle.keyHash,
          set: {
            failures: next,
            lockedUntil: sql`case when ${next} > ${FREE_FAILURES}
              then now() + make_interval(secs => least(2 ^ least(${next} - ${FREE_FAILURES} - 1, 20), ${MAX_LOCK_SECONDS}))
              else null end`,
            updatedAt: sql`now()`,
          },
        });
    },

    async recordSuccess(email: string): Promise<void> {
      await db
        .delete(loginThrottle)
        .where(eq(loginThrottle.keyHash, keyOf(email)));
    },
  };
}
