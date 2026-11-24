import { describe, expect, it } from "vitest";

import {
  isPermanentJobError,
  JOB_RETRY,
  jobRetryDelaySeconds,
  PermanentJobError,
} from "@/src/jobs/policy";
import { ValidationError } from "@/src/providers/types";
import { SocialApiError } from "@/src/providers/socialapi";

describe("jobRetryDelaySeconds (BE-JOB-003)", () => {
  it("tăng theo cấp số nhân, có jitter, bị chặn bởi trần", () => {
    const lo = (n: number) => jobRetryDelaySeconds(n, () => 0);
    const hi = (n: number) => jobRetryDelaySeconds(n, () => 1);
    // Không jitter: 15, 30, 60, 120 (delay=30 → 30·2^n/2).
    expect([0, 1, 2, 3].map(lo)).toEqual([15, 30, 60, 120]);
    // Jitter tối đa gấp đôi mức nền.
    expect([0, 1, 2, 3].map(hi)).toEqual([30, 60, 120, 240]);
    // Cùng lần thử, jitter khác → giá trị khác.
    expect(jobRetryDelaySeconds(2, () => 0.2)).not.toBe(
      jobRetryDelaySeconds(2, () => 0.8),
    );
    // Trần: không vượt retryDelayMax dù số lần thử lớn hoặc không hợp lệ.
    for (const n of [12, 16, 100, -5, 2.7])
      expect(jobRetryDelaySeconds(n, () => 1)).toBeLessThanOrEqual(
        JOB_RETRY.retryDelayMax,
      );
    expect(jobRetryDelaySeconds(100, () => 1)).toBe(JOB_RETRY.retryDelayMax);
  });

  it("số lần thử mặc định trong khoảng 3–5", () => {
    expect(JOB_RETRY.retryLimit).toBeGreaterThanOrEqual(3);
    expect(JOB_RETRY.retryLimit).toBeLessThanOrEqual(5);
    expect(JOB_RETRY.retryBackoff).toBe(true);
  });
});

describe("isPermanentJobError", () => {
  it("lỗi dữ liệu/4xx nghiệp vụ là vĩnh viễn; 408, 429, 5xx và lỗi lạ đáng thử lại", () => {
    expect(isPermanentJobError(new PermanentJobError("x"))).toBe(true);
    expect(isPermanentJobError(new ValidationError("x"))).toBe(true);
    for (const s of [400, 401, 403, 404, 422])
      expect(
        isPermanentJobError(new SocialApiError("x", s, "c")),
        String(s),
      ).toBe(true);
    for (const s of [408, 429, 500, 502, 503])
      expect(
        isPermanentJobError(new SocialApiError("x", s, "c")),
        String(s),
      ).toBe(false);
    expect(isPermanentJobError(new Error("kết nối hỏng"))).toBe(false);
    expect(isPermanentJobError(undefined)).toBe(false);
  });
});
