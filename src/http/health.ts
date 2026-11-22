export interface HealthResult {
  status: 200 | 503;
  body: { status: "ok" | "degraded" };
}

/**
 * Kiểm sức khoẻ cho healthcheck/giám sát: chỉ nói "ok" hay "degraded", không lộ nguyên nhân (thông điệp
 * lỗi CSDL có thể chứa tên người dùng/máy). Có thời hạn để việc kiểm không treo theo CSDL.
 */
export async function checkHealth(
  ping: () => Promise<void>,
  timeoutMs: number,
): Promise<HealthResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      ping(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
    return { status: 200, body: { status: "ok" } };
  } catch {
    return { status: 503, body: { status: "degraded" } };
  } finally {
    clearTimeout(timer);
  }
}
