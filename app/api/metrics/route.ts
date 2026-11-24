import { processEnv } from "@/src/config/env";
import { metrics } from "@/src/observability/metrics";
import { checkMetricsAccess } from "@/src/observability/metrics-auth";

/** Metric Prometheus. Đóng mặc định; mở bằng METRICS_TOKEN (Bearer). Không chứa dữ liệu người dùng: nhãn chỉ là route mẫu/mã trạng thái. */
export async function GET(req: Request) {
  const access = checkMetricsAccess(
    processEnv().METRICS_TOKEN,
    req.headers.get("authorization"),
  );
  if (access === "disabled") return new Response("Not Found", { status: 404 });
  if (access === "denied")
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });
  return new Response(metrics.render(), {
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
