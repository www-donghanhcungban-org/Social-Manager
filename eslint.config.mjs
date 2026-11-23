import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // BASE-DATA-003: thiếu (null/undefined) ≠ 0/""/false — không dùng `||` để lấy mặc định cho giá trị hợp lệ là 0/rỗng.
  // Cần thông tin kiểu nên chỉ áp cho mã ứng dụng (T-514).
  {
    files: ["src/**/*.ts", "app/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      // QA-STATIC-005: không console.* gỡ lỗi trong mã ứng dụng (dùng src/log/logger.ts).
      "no-console": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Đầu ra sinh tự động (git-ignore): không phải mã của dự án.
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
