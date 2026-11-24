import { metrics } from "./metrics";

/**
 * Bọc route handler để đo thời gian và mã trạng thái (RED). `route` là MẪU cố định do mã nguồn khai, không lấy từ URL
 * thật: nhờ vậy số series bị chặn bởi số route, không bởi đầu vào của kẻ tấn công.
 */
export function timed<A extends unknown[]>(
  method: string,
  route: string,
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    const t0 = performance.now();
    let status = 500;
    try {
      const res = await handler(...args);
      status = res.status;
      return res;
    } finally {
      metrics.observeHttp({
        method,
        route,
        status,
        seconds: (performance.now() - t0) / 1000,
      });
    }
  };
}
