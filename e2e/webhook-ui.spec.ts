import { createHmac } from "node:crypto";

import { expect, test } from "@playwright/test";

test.skip(!process.env.E2E_DATABASE_URL, "cần E2E_DATABASE_URL");

const PASSWORD = "mat-khau-du-dai-123";
const unique = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const SECRET = "ui".repeat(32);

test("bật webhook ở màn hình Kết nối → tin gửi tới địa chỉ đó hiện trong Hộp thư; secret không hiện lại", async ({
  page,
  request, // ngữ cảnh không cookie, như máy chủ SocialAPI thật (page.request mang cookie nên bị lớp CSRF chặn)
}) => {
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Chưa có tài khoản? Tạo mới" })
    .click();
  await page.getByLabel("Tên hiển thị").fill("Người thử");
  await page.getByLabel("Email").fill(`${unique()}@example.com`);
  await page.getByLabel("Mật khẩu").fill(PASSWORD);
  await page.getByRole("button", { name: "Tạo tài khoản" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByLabel(/Tên workspace/).fill("Shop webhook");
  await page.getByRole("button", { name: "Tạo workspace" }).click();
  await expect(page).toHaveURL(/\/app\/[0-9a-f-]{36}$/);
  await page.getByRole("link", { name: "Kết nối" }).click();

  await page
    .locator('select[name="provider"]')
    .selectOption({ label: "SocialAPI" });
  await page
    .getByLabel("Nhãn (để phân biệt các kết nối)")
    .fill("SocialAPI chính");
  await page.getByLabel(/Khoá API/).fill("sk-gia-khong-goi-mang");
  await page.getByRole("button", { name: "Thêm kết nối" }).click();
  const item = page.getByRole("listitem", { name: "Kết nối SocialAPI chính" });
  await expect(item).toBeVisible();

  const account = `acc_${unique()}`;
  await item.getByText("Thêm tài khoản vào kết nối này").click();
  await item.getByLabel("Nền tảng").selectOption("instagram");
  await item.getByLabel("Mã tài khoản (id bên nhà cung cấp)").fill(account);
  await item.getByLabel("Tên hiển thị").fill("Trang IG");
  await item.getByRole("button", { name: "Thêm tài khoản" }).click();
  await expect(item.getByText("Trang IG")).toBeVisible();

  await item.getByText(/Nhận tin theo thời gian thực/).click();
  // secret quá ngắn bị từ chối rõ ràng
  await item.getByLabel("Secret webhook").fill("ngan");
  await item.getByRole("button", { name: "Lưu secret" }).click();
  // (trình duyệt chặn bằng minLength; lỗi máy chủ được kiểm ở test dịch vụ)
  await expect(item.getByText(/đã bật/)).toHaveCount(0);

  await item.getByLabel("Secret webhook").fill(SECRET);
  await item.getByRole("button", { name: "Lưu secret" }).click();
  await expect(item.getByText(/— đã bật/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText(SECRET);
  await expect(page.locator(`input[value="${SECRET}"]`)).toHaveCount(0);

  const url = (await item.getByLabel(/Địa chỉ webhook của/).innerText()).trim();
  expect(url).toMatch(/\/api\/webhooks\/socialapi\/[0-9a-f-]{36}$/);

  const body = JSON.stringify({
    event: "dm.received",
    data: {
      id: `sapi_dm_${unique()}`,
      platform: "instagram",
      author: { id: "u1", name: "Khách Hàng" },
      content: { text: "Xin giá áo sơ mi" },
      received_at: new Date().toISOString(),
      account_id: account,
    },
  });
  const ts = Math.floor(Date.now() / 1000);
  const sig = `sha256=${createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex")}`;
  // Địa chỉ hiển thị theo BETTER_AUTH_URL; gọi vào server thử nghiệm bằng đúng đường dẫn đó.
  const res = await request.post(new URL(url).pathname, {
    headers: {
      "content-type": "application/json",
      "x-socialapi-timestamp": String(ts),
      "x-socialapi-signature-v2": sig,
    },
    data: body,
  });
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: "ok", inserted: 1 });

  await page.getByRole("link", { name: "Hộp thư" }).click();
  await expect(page.getByText("Xin giá áo sơ mi")).toBeVisible();
  await expect(page.getByText("Khách Hàng")).toBeVisible();

  // Tắt webhook → ngừng nhận
  await page.getByRole("link", { name: "Kết nối" }).click();
  await item.getByText(/Nhận tin theo thời gian thực/).click();
  await item.getByRole("button", { name: "Tắt webhook (xoá secret)" }).click();
  await expect(item.getByText(/— đã bật/)).toHaveCount(0);
  const after = await request.post(new URL(url).pathname, {
    headers: {
      "content-type": "application/json",
      "x-socialapi-timestamp": String(ts),
      "x-socialapi-signature-v2": sig,
    },
    data: body,
  });
  expect(after.status()).toBe(401);
});
