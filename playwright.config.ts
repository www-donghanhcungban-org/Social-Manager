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
  },
  use: {
    baseURL: "http://localhost:3100",
    launchOptions: executablePath
      ? { executablePath, args: ["--no-sandbox"] }
      : {},
  },
});
