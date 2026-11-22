import { expect, test } from "@playwright/test";

test("trang chủ trả 200 và có tiêu đề", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveTitle(/.+/);
});
