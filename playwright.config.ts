import { defineConfig, devices } from "@playwright/test";

// Môi trường cloud có sẵn Chromium ở PW_CHROMIUM_PATH; CI cài bằng `playwright install` (e2e_setup).
const executablePath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: "e2e",
  // QA-STRAT-008: `test.only` lọt vào nhánh chính làm CI chạy một phần mà vẫn xanh.
  forbidOnly: !!process.env.CI,
  // UX-RESP-008: luồng chính chạy trên cả desktop và thiết bị di động giả lập (cùng Chromium).
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npx next start -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 60_000,
    // Server kiểm cấu hình lúc khởi động (instrumentation.ts): cấp giá trị giả hợp lệ.
    // Không đặt E2E_DATABASE_URL thì dùng URL giả đúng định dạng (chỉ chạy được các test không đụng DB);
    // đặt nó (DB đã `npm run db:migrate`) thì chạy cả các luồng cần DB.
    env: {
      RUN_WORKERS: "false",
      // Các test chạy song song từ cùng một IP: nâng hạn mức để không bị 429 giả.
      AUTH_RATE_LIMIT_PER_MIN: "1000",
      DATABASE_URL:
        process.env.E2E_DATABASE_URL ?? "postgres://e2e:e2e@localhost:5432/e2e",
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
