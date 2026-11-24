import { expect, test } from "@playwright/test";

import { expectNoA11yViolations } from "./helpers/a11y";

test("chưa đăng nhập: trang chủ chuyển tới /login có tiêu đề và form @smoke", async ({
  page,
}) => {
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page).toHaveTitle(/Đăng nhập/);
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Mật khẩu")).toBeVisible();
  await expectNoA11yViolations(page, "/login");
});

test("chưa đăng nhập: /app và workspace bị chuyển về /login @smoke", async ({
  page,
}) => {
  for (const path of ["/app", "/app/3f2b1c1e-0000-4000-8000-000000000000"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
  await expectNoA11yViolations(page, "/login sau chuyển hướng");
});
