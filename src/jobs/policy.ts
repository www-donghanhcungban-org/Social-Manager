import { z } from "zod";

import { ValidationError } from "../providers/types";
import { SocialApiError } from "../providers/socialapi";

/**
 * Chính sách job (BE-JOB-001/003/004/007). Hàm thuần, không I/O: runner và test dùng chung.
 * Hàng đợi nền là pg-boss trên Postgres; mỗi hàng đợi có một hàng "chết" (`<tên>.dlq`) giữ payload + lỗi.
 */

/** Thử lại hữu hạn: 4 lần (trong khoảng 3–5), cách nhau mũ có jitter, trần 1 giờ. */
export const JOB_RETRY = {
  retryLimit: 4,
  retryDelay: 30,
  retryBackoff: true,
  retryDelayMax: 3_600,
} as const;

/** Hàng chết giữ lâu hơn hàng gốc (hàng gốc giữ mặc định ~14 ngày của pg-boss; DLQ 30 ngày). */
export const DLQ_RETENTION_SECONDS = 30 * 24 * 3_600;

export const dlqName = (queue: string) => `${queue}.dlq`;

/**
 * Độ trễ (giây) trước lần thử lại thứ `retryCount` (0 = lần đầu thất bại). Cùng công thức pg-boss áp khi
 * `retryBackoff: true`: min(max, delay × (2^n/2 + 2^n/2 × random)), n ≤ 16 — để test khẳng định tăng mũ, có jitter, có trần.
 */
export function jobRetryDelaySeconds(
  retryCount: number,
  random: () => number = Math.random,
  policy: { retryDelay: number; retryDelayMax: number } = JOB_RETRY,
): number {
  const n = Math.min(16, Math.max(0, Math.trunc(retryCount)));
  const half = 2 ** n / 2;
  return Math.min(
    policy.retryDelayMax,
    policy.retryDelay * (half + half * random()),
  );
}

/** Lỗi vĩnh viễn: thử lại vô ích (dữ liệu job sai, 4xx nghiệp vụ) → vào DLQ ngay, không retry. */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

export function isPermanentJobError(error: unknown): boolean {
  if (error instanceof PermanentJobError) return true;
  if (error instanceof ValidationError) return true;
  if (error instanceof SocialApiError) {
    // 4xx nghiệp vụ; 408 (hết giờ) và 429 (quá tải, có Retry-After) vẫn đáng thử lại.
    return (
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 408 &&
      error.status !== 429
    );
  }
  return false;
}

/** Payload job chỉ gồm ID (BE-JOB-007): không bí mật, không object đã serialize. `.strict()` chặn trường lạ. */
export const syncAccountPayload = z
  .object({
    workspaceId: z.string().min(1).max(64),
    accountId: z.string().min(1).max(64),
  })
  .strict();
export type SyncAccountPayload = z.infer<typeof syncAccountPayload>;

export function parseSyncAccountPayload(data: unknown): SyncAccountPayload {
  const r = syncAccountPayload.safeParse(data);
  if (!r.success) throw new PermanentJobError("dữ liệu job không hợp lệ");
  return r.data;
}

/** Nội dung bản ghi trong hàng chết khi job bị loại ngay vì lỗi vĩnh viễn. */
export function deadLetterRecord(input: {
  queue: string;
  payload: unknown;
  error: unknown;
}) {
  return {
    sourceQueue: input.queue,
    payload: input.payload ?? null,
    error:
      input.error instanceof Error ? input.error.message : String(input.error),
    attempts: 1,
    permanent: true,
  };
}
