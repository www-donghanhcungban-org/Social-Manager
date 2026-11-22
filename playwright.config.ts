import { defineConfig } from "@playwright/test";

// Môi trường cloud có sẵn Chromium ở PW_CHROMIUM_PATH; CI cài bằng `playwright install` (e2e_setup).
const executablePath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: "e2e",
  webServer: {
    command: "npx next start -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 60_000,
    // Server kiểm cấu hình lúc khởi động (instrumentation.ts): cấp giá trị giả hợp lệ.
    // Chưa nối DB thật nên chỉ cần đúng định dạng.
    env: {
      DATABASE_URL: "postgres://e2e:e2e@localhost:5432/e2e",
      BETTER_AUTH_SECRET: "e2e-secret-".padEnd(48, "x"),
      BETTER_AUTH_URL: "http://localhost:3100",
      APP_SECRET_KEY: Buffer.alloc(32, 7).toString("base64"),
    },
  },
  use: {
    baseURL: "http://localhost:3100",
    launchOptions: executablePath
      ? { executablePath, args: ["--no-sandbox"] }
      : {},
  },
});
