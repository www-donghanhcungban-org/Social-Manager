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

test("hội thoại → soạn nháp → sửa tạo phiên bản mới → yêu cầu gửi bị chặn vì gửi đang tắt [F-006/AC-02] [F-006/AC-06]", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("link", { name: "Hội thoại", exact: true }).click();
  const list = page.getByRole("list", { name: "Danh sách hội thoại" });
  await expect(list.getByRole("listitem")).not.toHaveCount(0);
  await list.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/conversations\/[0-9a-f-]{36}$/);

  // gửi tin đang tắt (mặc định): trang nói rõ, vẫn soạn được nháp
  await expect(page.getByRole("note")).toContainText("Gửi tin đang tắt");
  await page.getByLabel("Soạn trả lời").fill("Dạ còn hàng ạ");
  await page.getByRole("button", { name: "Lưu nháp" }).click();
  // Lưu xong trang dựng lại biên soạn theo phiên bản mới: nhãn đổi sang "phiên bản 1" là dấu hiệu đã lưu.
  await expect(page.getByLabel("Nháp (phiên bản 1)")).toHaveValue(
    "Dạ còn hàng ạ",
  );

  await page.getByLabel("Nháp (phiên bản 1)").fill("Dạ còn hàng, mời bạn ạ");
  await page.getByRole("button", { name: "Lưu nháp" }).click();
  await expect(page.getByLabel("Nháp (phiên bản 2)")).toHaveValue(
    "Dạ còn hàng, mời bạn ạ",
  );

  // yêu cầu gửi: bị chặn, không có gì ra ngoài; lịch sử ghi trạng thái
  await page.getByRole("button", { name: "Yêu cầu gửi" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /chưa bật gửi|tắt/ }),
  ).toBeVisible();
  const history = page.getByRole("region", { name: "Lịch sử gửi" });
  await expect(history).toContainText("Bị chặn, chưa gửi");
});
