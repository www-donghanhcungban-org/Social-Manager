import { expect, test, type Page } from "@playwright/test";

test.skip(!process.env.E2E_DATABASE_URL, "cần E2E_DATABASE_URL");

const PASSWORD = "mat-khau-du-dai-123";
const unique = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

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
  await page.getByLabel(/Tên workspace/).fill("Shop đăng bài");
  await page.getByRole("button", { name: "Tạo workspace" }).click();
  await expect(page).toHaveURL(/\/app\/[0-9a-f-]{36}$/);
  await page.getByRole("link", { name: "Đăng bài" }).click();
  await expect(page).toHaveURL(/\/posts$/);
}

async function addAccount(page: Page) {
  await page.getByRole("link", { name: "Kết nối", exact: true }).click();
  await page.getByLabel("Nhãn (để phân biệt các kết nối)").fill("Demo");
  await page.getByLabel(/Khoá API/).fill("k");
  await page.getByRole("button", { name: "Thêm kết nối" }).click();
  const item = page.getByRole("listitem", { name: "Kết nối Demo" });
  await item.getByText("Thêm tài khoản vào kết nối này").click();
  await item.getByLabel("Mã tài khoản (id bên nhà cung cấp)").fill("page-1");
  await item.getByLabel("Tên hiển thị").fill("Trang Một");
  await item.getByRole("button", { name: "Thêm tài khoản" }).click();
  await expect(item.getByText("Trang Một")).toBeVisible();
  await page.getByRole("link", { name: "Đăng bài" }).click();
  await expect(page).toHaveURL(/\/posts$/);
}

test("chưa có tài khoản: hướng dẫn thêm, không có form", async ({ page }) => {
  await setup(page);
  await expect(page.getByText("Cần ít nhất một tài khoản")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Đăng / hẹn giờ" }),
  ).toHaveCount(0);
});

test("xếp lịch đăng ngay và hẹn giờ tương lai; giờ quá khứ bị từ chối rõ ràng", async ({
  page,
}) => {
  await setup(page);
  await addAccount(page);
  const list = page.getByRole("list", { name: "Danh sách bài đăng" });
  const form = page.locator("form", {
    has: page.getByRole("button", { name: "Đăng / hẹn giờ" }),
  });

  await form.getByLabel("Nội dung").fill("Bài đăng ngay lúc này");
  await form.getByRole("button", { name: "Đăng / hẹn giờ" }).click();
  await expect(list.getByText("Bài đăng ngay lúc này")).toBeVisible();
  await expect(list.getByText("Đã xếp lịch").first()).toBeVisible();
  // form được làm sạch sau khi thành công
  await expect(form.getByLabel("Nội dung")).toHaveValue("");

  // hẹn giờ tương lai (giờ địa phương của trình duyệt → lưu UTC)
  const future = new Date(Date.now() + 3 * 24 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const local = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}`;
  await form.getByLabel("Nội dung").fill("Bài hẹn giờ ba ngày sau");
  await form.getByLabel(/Hẹn giờ/).fill(local);
  await form.getByRole("button", { name: "Đăng / hẹn giờ" }).click();
  const item = list
    .getByRole("listitem")
    .filter({ hasText: "Bài hẹn giờ ba ngày sau" });
  await expect(item).toBeVisible();
  const iso = await item.locator("time").getAttribute("datetime");
  expect(
    Math.abs(new Date(iso!).getTime() - new Date(local).getTime()),
  ).toBeLessThan(60_000);

  // giờ quá khứ
  const past = new Date(Date.now() - 3600 * 1000);
  const pastLocal = `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}T${pad(past.getHours())}:${pad(past.getMinutes())}`;
  await form.getByLabel("Nội dung").fill("Bài giờ quá khứ");
  await form.getByLabel(/Hẹn giờ/).fill(pastLocal);
  await form.getByRole("button", { name: "Đăng / hẹn giờ" }).click();
  await expect(form.locator("p[role=alert]")).toContainText(
    "Giờ hẹn phải ở tương lai",
  );
  await expect(list.getByText("Bài giờ quá khứ")).toHaveCount(0);
});

test("nội dung chỉ có khoảng trắng bị từ chối", async ({ page }) => {
  await setup(page);
  await addAccount(page);
  const form = page.locator("form", {
    has: page.getByRole("button", { name: "Đăng / hẹn giờ" }),
  });
  // `required` của trình duyệt chấp nhận khoảng trắng; máy chủ phải từ chối.
  await form.getByLabel("Nội dung").fill("   ");
  await form.getByRole("button", { name: "Đăng / hẹn giờ" }).click();
  await expect(form.locator("p[role=alert]")).toContainText(
    "Nội dung bài đăng không được rỗng",
  );
});

test("người ngoài workspace không xem được trang đăng bài", async ({
  browser,
}) => {
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
