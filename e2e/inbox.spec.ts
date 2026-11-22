import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

test.skip(!process.env.E2E_DATABASE_URL, "cần E2E_DATABASE_URL");

const PASSWORD = "mat-khau-du-dai-123";
const unique = () => `e2e-${randomUUID()}`;

async function setup(page: Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Chưa có tài khoản? Tạo mới" })
    .click();
  await page.getByLabel("Tên hiển thị").fill("Người thử");
  await page.getByLabel("Email").fill(`${unique()}@example.com`);
  await page.getByLabel("Mật khẩu").fill(PASSWORD);
  await page.getByRole("button", { name: "Tạo tài khoản" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByLabel(/Tên workspace/).fill("Shop hộp thư");
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
  await expect(page).toHaveURL(/\/inbox$/);
}

test("hộp thư trống → đồng bộ → lọc → đánh dấu đã xử lý → đồng bộ lại không trùng", async ({
  page,
}) => {
  await setup(page);
  await expect(page.getByText("Không có tin nào")).toBeVisible();

  await page.getByRole("button", { name: "Đồng bộ Trang Một" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Đã nhập" }),
  ).toContainText(/Đã nhập \d+ tin mới/);
  const list = page.getByRole("list", { name: "Danh sách tin" });
  await expect(list.getByRole("listitem")).not.toHaveCount(0);
  const total = await list.getByRole("listitem").count();

  // lọc theo loại
  await page.getByRole("link", { name: "Bình luận", exact: true }).click();
  await expect(page).toHaveURL(/kind=comment/);
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByRole("listitem").first()).toContainText("Bình luận");
  await page.getByRole("link", { name: "Mọi loại" }).click();

  // đánh dấu đã xử lý rồi lọc theo trạng thái
  await list
    .getByRole("listitem")
    .first()
    .getByRole("button", { name: /Đánh dấu đã xử lý/ })
    .click();
  await page.getByRole("link", { name: "Đã xử lý", exact: true }).click();
  await expect(list.getByRole("listitem")).toHaveCount(1);

  // đồng bộ lại: không tạo bản trùng, không ghi đè trạng thái đã xử lý
  await page.getByRole("link", { name: "Mọi trạng thái" }).click();
  await page.getByRole("button", { name: "Đồng bộ Trang Một" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Đã nhập" }),
  ).toContainText("Đã nhập 0 tin mới");
  await expect(list.getByRole("listitem")).toHaveCount(total);
  await page.getByRole("link", { name: "Đã xử lý", exact: true }).click();
  await expect(list.getByRole("listitem")).toHaveCount(1);
});

test("tham số lọc và cursor bậy không gây lỗi, không lộ dữ liệu", async ({
  page,
}) => {
  await setup(page);
  const base = page.url();
  for (const q of [
    "?kind=<script>alert(1)</script>",
    "?status=drop%20table",
    "?cursor=!!!",
    "?kind=comment&kind=dm",
  ]) {
    const res = await page.goto(base + q);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Hộp thư" })).toBeVisible();
  }
});

test("người ngoài workspace không xem được hộp thư", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  await setup(a);
  const url = a.url();
  const b = await (await browser.newContext()).newPage();
  await b.goto("/login");
  await b.getByRole("button", { name: "Chưa có tài khoản? Tạo mới" }).click();
  await b.getByLabel("Tên hiển thị").fill("Khác");
  await b.getByLabel("Email").fill(`${unique()}@example.com`);
  await b.getByLabel("Mật khẩu").fill(PASSWORD);
  await b.getByRole("button", { name: "Tạo tài khoản" }).click();
  await expect(b).toHaveURL(/\/app$/);
  await b.goto(url);
  await expect(
    b.getByRole("heading", { name: "Không tìm thấy trang" }),
  ).toBeVisible();
});
