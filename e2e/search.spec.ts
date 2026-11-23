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
  await page.getByLabel(/Tên workspace/).fill("Shop hội thoại");
  await page.getByRole("button", { name: "Tạo workspace" }).click();
  await expect(page).toHaveURL(/\/app\/[0-9a-f-]{36}$/);
  await page.getByRole("link", { name: "Kết nối" }).click();
  await page.getByLabel("Nhãn (để phân biệt các kết nối)").fill("Demo");
  await page.getByLabel(/Khoá API/).fill("k");
  await page.getByRole("button", { name: "Thêm kết nối" }).click();
  const item = page.getByRole("listitem", { name: "Kết nối Demo" });
  await item.getByText("Thêm tài khoản vào kết nối này").click();
  await item.getByLabel("Mã tài khoản (id bên nhà cung cấp)").fill("page-1");
  await item.getByLabel("Tên hiển thị").fill("Trang Một");
  await item.getByRole("button", { name: "Thêm tài khoản" }).click();
  await expect(item.getByText("Trang Một")).toBeVisible();
  await page.getByRole("link", { name: "Hộp thư" }).click();
  await page.getByRole("button", { name: "Đồng bộ Trang Một" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Đã nhập" }),
  ).toContainText(/Đã nhập \d+ tin mới/);
}

test("tìm trong tin đã đồng bộ (không phân biệt dấu) và hỏi đáp báo AI chưa bật", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("link", { name: "Tìm kiếm", exact: true }).click();
  await expect(page).toHaveURL(/\/search$/);

  // AI tắt mặc định: không có form hỏi, trang nói rõ
  await expect(page.getByRole("note")).toContainText("AI chưa được bật");
  await expect(page.getByLabel("Câu hỏi")).toHaveCount(0);

  await page.getByLabel("Từ khoá").fill("con hang");
  await page.getByRole("button", { name: "Tìm", exact: true }).click();
  await expect(page).toHaveURL(/q=con\+hang|q=con%20hang/);
  const list = page.getByRole("list", { name: "Kết quả tìm kiếm" });
  await expect(list.getByRole("listitem")).not.toHaveCount(0);
  await expect(list).toContainText("còn hàng");

  await page.getByLabel("Từ khoá").fill("khongcotukhoanaonhuvay");
  await page.getByRole("button", { name: "Tìm", exact: true }).click();
  await expect(page.getByText("Không có kết quả.")).toBeVisible();
});
