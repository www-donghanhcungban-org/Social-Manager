import { expect, test } from "@playwright/test";

test("chưa đăng nhập: trang chủ chuyển tới /login có tiêu đề và form", async ({
  page,
}) => {
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page).toHaveTitle(/Đăng nhập/);
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Mật khẩu")).toBeVisible();
});

test("chưa đăng nhập: /app và workspace bị chuyển về /login", async ({
  page,
}) => {
  for (const path of ["/app", "/app/3f2b1c1e-0000-4000-8000-000000000000"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
});
