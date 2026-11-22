import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

test.skip(!process.env.E2E_DATABASE_URL, "cần E2E_DATABASE_URL");

const PASSWORD = "mat-khau-du-dai-123";
const unique = () => `e2e-${randomUUID()}`;

async function signUpAndCreateWorkspace(page: Page, name: string) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Chưa có tài khoản? Tạo mới" })
    .click();
  await page.getByLabel("Tên hiển thị").fill("Người thử");
  await page.getByLabel("Email").fill(`${unique()}@example.com`);
  await page.getByLabel("Mật khẩu").fill(PASSWORD);
  await page.getByRole("button", { name: "Tạo tài khoản" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByLabel(/Tên workspace/).fill(name);
  await page.getByRole("button", { name: "Tạo workspace" }).click();
  await expect(page).toHaveURL(/\/app\/[0-9a-f-]{36}$/);
}

test("thêm kết nối demo → thêm tài khoản → khoá không hiện lại → xoá", async ({
  page,
}) => {
  await signUpAndCreateWorkspace(page, "Shop kết nối");
  await page.getByRole("link", { name: "Kết nối" }).click();
  await expect(page.getByText("Chưa có kết nối nào")).toBeVisible();

  const secret = "sk-khong-duoc-hien-lai-123";
  await page.getByLabel("Nhãn (để phân biệt các kết nối)").fill("Demo chính");
  await page.getByLabel(/Khoá API/).fill(secret);
  await page.getByRole("button", { name: "Thêm kết nối" }).click();
  const item = page.getByRole("listitem", { name: "Kết nối Demo chính" });
  await expect(item).toBeVisible();
  await expect(page.locator("body")).not.toContainText(secret);
  await expect(page.locator(`input[value="${secret}"]`)).toHaveCount(0);

  await item.getByText("Thêm tài khoản vào kết nối này").click();
  await item.getByLabel("Mã tài khoản (id bên nhà cung cấp)").fill("page-1");
  await item.getByLabel("Tên hiển thị").fill("Trang Một");
  await item.getByRole("button", { name: "Thêm tài khoản" }).click();
  await expect(item.getByText("Trang Một")).toBeVisible();
  await expect(item.getByText(/facebook · page-1/)).toBeVisible();

  await item.getByRole("button", { name: "Xoá tài khoản Trang Một" }).click();
  await expect(item.getByText("Chưa có tài khoản nào")).toBeVisible();
  await item.getByRole("button", { name: "Xoá kết nối Demo chính" }).click();
  await expect(page.getByText("Chưa có kết nối nào")).toBeVisible();
});

test("nhãn kết nối trùng báo lỗi rõ, không tạo thêm", async ({ page }) => {
  await signUpAndCreateWorkspace(page, "Shop trùng nhãn");
  await page.getByRole("link", { name: "Kết nối" }).click();
  for (const expected of ["ok", "dup"]) {
    await page.getByLabel("Nhãn (để phân biệt các kết nối)").fill("Cùng nhãn");
    await page.getByLabel(/Khoá API/).fill("k");
    await page.getByRole("button", { name: "Thêm kết nối" }).click();
    if (expected === "dup") {
      const addForm = page.locator("form", {
        has: page.getByRole("button", { name: "Thêm kết nối" }),
      });
      await expect(addForm.locator("p[role=alert]")).toContainText(
        "Đã có kết nối cùng nguồn và nhãn này",
      );
    } else {
      await expect(
        page.getByRole("listitem", { name: "Kết nối Cùng nhãn" }),
      ).toBeVisible();
    }
  }
  await expect(
    page.getByRole("listitem", { name: "Kết nối Cùng nhãn" }),
  ).toHaveCount(1);
});

test("người khác không mở được trang kết nối của workspace mình", async ({
  browser,
}) => {
  const a = await (await browser.newContext()).newPage();
  await signUpAndCreateWorkspace(a, "Riêng A");
  await a.getByRole("link", { name: "Kết nối" }).click();
  const url = a.url();
  const b = await (await browser.newContext()).newPage();
  await signUpAndCreateWorkspace(b, "Của B");
  await b.goto(url);
  await expect(
    b.getByRole("heading", { name: "Không tìm thấy trang" }),
  ).toBeVisible();
});
