import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// FE-TEST-003: múi giờ cố định để test không đổi kết quả theo máy chạy (worker kế thừa môi trường này).
process.env.TZ = "UTC";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // QA-COV-001: báo cáo có nhánh, lưu artifact `coverage/` ở CI.
      reporter: ["text-summary", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      // Sàn M và ratchet (QA-COV-002): dưới ngưỡng thì cổng đỏ; chỉ được TĂNG (tests/config/test-strategy.test.ts
      // giữ BASELINE). Không hạ ngưỡng để làm cổng xanh.
      // Đo ngày 2026-11-23 (PGlite, không có TEST_DATABASE_URL): lines 94,0 · statements 92,1 · branches 89,3 · functions 85,8.
      thresholds: { lines: 90, functions: 85, branches: 85, statements: 90 },
    },
  },
});
