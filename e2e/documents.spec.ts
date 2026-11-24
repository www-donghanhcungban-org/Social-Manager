import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

test.skip(!process.env.E2E_DATABASE_URL, "cần E2E_DATABASE_URL");

const PASSWORD = "mat-khau-du-dai-123";

async function setup(page: Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Chưa có tài khoản? Tạo mới" })
    .click();
  await page.getByLabel("Tên hiển thị").fill("Người thử");
  await page.getByLabel("Email").fill(`e2e-${randomUUID()}@example.com`);
  await page.getByLabel("Mật khẩu").fill(PASSWORD);
  await page.getByRole("button", { name: "Tạo tài khoản" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByLabel(/Tên workspace/).fill("Shop tài liệu");
  await page.getByRole("button", { name: "Tạo workspace" }).click();
  await expect(page).toHaveURL(/\/app\/[0-9a-f-]{36}$/);
}

test("nhập tài liệu → nhập lại không trùng → tìm thấy; tạo dự án [F-007/AC-01] [F-007/AC-02] [F-007/AC-04]", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("link", { name: "Tài liệu", exact: true }).click();
  await expect(page).toHaveURL(/\/documents$/);

  await page.getByLabel("Tiêu đề").fill("Chính sách đổi trả");
  await page
    .getByLabel("Nội dung")
    .fill("Khách được đổi trả trong vòng bảy ngày kể từ khi nhận hàng.");
  await page.getByRole("button", { name: "Nhập tài liệu" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Đã nhập tài liệu" }),
  ).toBeVisible();

  // nhập lại đúng nội dung: báo đã có, không thêm. React 19 xoá trường form sau mỗi lần gửi nên phải điền lại.
  await page.getByLabel("Tiêu đề").fill("Chính sách đổi trả");
  await page
    .getByLabel("Nội dung")
    .fill("Khách được đổi trả trong vòng bảy ngày kể từ khi nhận hàng.");
  await page.getByRole("button", { name: "Nhập tài liệu" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "đã có" }),
  ).toBeVisible();

  // tìm thấy, không phân biệt dấu
  await page.getByRole("link", { name: "Tìm kiếm", exact: true }).click();
  await page.getByLabel("Từ khoá").fill("doi tra");
  await page.getByRole("button", { name: "Tìm", exact: true }).click();
  const list = page.getByRole("list", { name: "Kết quả tìm kiếm" });
  await expect(list).toContainText("Chính sách đổi trả");

  // dự án
  await page.getByRole("link", { name: "Tài liệu", exact: true }).click();
  await page.getByLabel("Tên dự án").fill("Cửa hàng Hoa");
  await page.getByRole("button", { name: "Tạo dự án" }).click();
  await expect(
    page.getByRole("list", { name: "Danh sách dự án" }),
  ).toContainText("Cửa hàng Hoa");

  await page.getByLabel("Bí danh cho Cửa hàng Hoa").fill("Hoa Sài Gòn");
  await page.getByRole("button", { name: "Thêm bí danh" }).click();
  const aliases = page.getByRole("list", { name: "Bí danh của Cửa hàng Hoa" });
  await expect(aliases).toContainText("Hoa Sài Gòn");
  await page.getByLabel("Bí danh cho Cửa hàng Hoa").fill("hoa sài gòn");
  await page.getByRole("button", { name: "Thêm bí danh" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Bí danh" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Xoá bí danh Hoa Sài Gòn" }).click();
  await expect(aliases).toHaveCount(0);
});
