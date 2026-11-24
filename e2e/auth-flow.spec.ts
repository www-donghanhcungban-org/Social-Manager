import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { expectNoA11yViolations } from "./helpers/a11y";

// Cần DB đã migrate: đặt E2E_DATABASE_URL. Không đặt thì bỏ qua.
test.skip(!process.env.E2E_DATABASE_URL, "cần E2E_DATABASE_URL");

const PASSWORD = "mat-khau-du-dai-123";
const unique = () => `e2e-${randomUUID()}`;

async function signUp(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Chưa có tài khoản? Tạo mới" })
    .click();
  await page.getByLabel("Tên hiển thị").fill("Người thử");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("button", { name: "Tạo tài khoản" }).click();
}

test("đăng ký → tạo workspace → đăng xuất → chặn truy cập → đăng nhập lại @smoke", async ({
  page,
}) => {
  const email = `${unique()}@example.com`;
  await signUp(page, email);
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText("Bạn chưa có workspace nào")).toBeVisible();

  await page.getByLabel(/Tên workspace/).fill("Cửa hàng thử");
  await page.getByRole("button", { name: "Tạo workspace" }).click();
  await expect(page).toHaveURL(/\/app\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { name: "Cửa hàng thử" }),
  ).toBeVisible();
  await expectNoA11yViolations(page, "tổng quan workspace");
  const workspaceUrl = page.url();

  await page.getByRole("button", { name: "Đăng xuất" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto(workspaceUrl);
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("link", { name: /Cửa hàng thử/ })).toBeVisible();
});

test("sai mật khẩu: báo lỗi chung, ở lại trang đăng nhập", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("khong-ton-tai@example.com");
  await page.getByLabel("Mật khẩu").fill("mat-khau-sai-123456");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.locator("form p[role=alert]")).toContainText(
    "Email hoặc mật khẩu không đúng",
  );
  await expect(page).toHaveURL(/\/login$/);
});

test("người khác không mở được workspace của mình (trang không tìm thấy, không lộ tên) [F-001/AC-05]", async ({
  browser,
}) => {
  const a = await (await browser.newContext()).newPage();
  await signUp(a, `${unique()}@example.com`);
  await a.getByLabel(/Tên workspace/).fill("Riêng của A");
  await a.getByRole("button", { name: "Tạo workspace" }).click();
  await expect(a).toHaveURL(/\/app\/[0-9a-f-]{36}$/);
  const url = a.url();
  // PRF-WEB-001: trang theo người dùng không dùng cache chia sẻ.
  const reload = await a.goto(url);
  expect(reload!.headers()["cache-control"]).toBe("private, no-store");

  const b = await (await browser.newContext()).newPage();
  await signUp(b, `${unique()}@example.com`);
  await expect(b).toHaveURL(/\/app$/);
  await b.goto(url);
  // Trang stream nên mã HTTP đã là 200 trước khi biết là notFound; nội dung mới là thứ được kiểm.
  await expect(
    b.getByRole("heading", { name: "Không tìm thấy trang" }),
  ).toBeVisible();
  await expect(b.getByText("Riêng của A")).toHaveCount(0);
});

test("đăng ký trùng email không lộ tài khoản đã có và không đổi mật khẩu", async ({
  browser,
}) => {
  const email = `${unique()}@example.com`;
  const first = await (await browser.newContext()).newPage();
  await signUp(first, email);
  await expect(first).toHaveURL(/\/app$/);

  const second = await (await browser.newContext()).newPage();
  await signUp(second, email, "mat-khau-khac-987654");
  await expect(second.locator("form p[role=alert]")).toContainText(
    "Không đăng ký hoặc đăng nhập được",
  );
  await expect(second).toHaveURL(/\/login$/);
});
