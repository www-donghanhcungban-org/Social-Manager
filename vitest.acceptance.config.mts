import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// T-583: cấu hình riêng của cổng nghiệm thu (xt.yaml `acceptance`). Giống vitest.config.mts (alias, múi giờ UTC) nhưng chỉ
// chạy tests/acceptance và xuất JUnit có thuộc tính `file`, để `xt.py acceptance lock` quy mỗi testcase về đúng tệp đã khoá.
process.env.TZ = "UTC";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    include: ["tests/acceptance/**/*.test.ts"],
    reporters: [
      [
        "junit",
        { outputFile: "reports/acceptance-junit.xml", addFileAttribute: true },
      ],
    ],
  },
});
