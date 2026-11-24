import { timed } from "@/src/observability/instrument";

/**
 * Liveness (OPS-OBS-006): tiến trình còn chạy. KHÔNG gọi phụ thuộc nào (CSDL chậm không được làm orchestrator giết tiến
 * trình). Readiness (kiểm CSDL, 503 khi tắt êm) là `/api/health`.
 */
export const GET = timed("GET", "/api/health/live", async () =>
  Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } }),
);
