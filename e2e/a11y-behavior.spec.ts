import { randomUUID } from "node:crypto";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { expectNoA11yViolations } from "./helpers/a11y";

test.skip(!process.env.E2E_DATABASE_URL, "cần E2E_DATABASE_URL");

const PASSWORD = "mat-khau-du-dai-123";
const unique = () => `e2e-${randomUUID()}@example.com`;

/** Nhấn Tab đến khi `target` có focus (tối đa `max` lần): chứng minh ô/nút với tới được bằng bàn phím, không bẫy focus. */
async function tabTo(page: Page, target: Locator, max = 20) {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("không Tab tới được phần tử");
}

test("UX-A11Y-003: đăng ký → tạo workspace chỉ bằng bàn phím (Tab/Enter), focus luôn thấy được", async ({
  page,
}) => {
  await page.goto("/login");
  await tabTo(
    page,
    page.getByRole("button", { name: "Chưa có tài khoản? Tạo mới" }),
  );
  await page.keyboard.press("Enter");

  await tabTo(page, page.getByLabel("Tên hiển thị"));
  await page.keyboard.type("Người dùng bàn phím");
  await page.keyboard.press("Tab");
  await page.keyboard.type(unique());
  await page.keyboard.press("Tab");
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app$/);

  const name = page.getByLabel(/Tên workspace/);
  await tabTo(page, name);
  // vòng focus nhìn thấy được (WCAG 2.4.7): outline có độ rộng > 0 khi focus bằng bàn phím
  const outline = await name.evaluate(
    (el) => getComputedStyle(el).outlineWidth,
  );
  expect(parseFloat(outline)).toBeGreaterThan(0);
  await page.keyboard.type("Workspace bàn phím");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/[0-9a-f-]{36}$/);
  await expectNoA11yViolations(page, "workspace sau luồng bàn phím");
});

test("FE-FORM-002: submit sai → ô nhập có aria-invalid và aria-describedby trỏ tới phần tử chứa lỗi", async ({
  page,
}) => {
  await page.goto("/login");
  const email = page.getByLabel("Email");
  await expect(email).not.toHaveAttribute("aria-invalid", "true");
  await email.fill("khong-ton-tai@example.com");
  await page.getByLabel("Mật khẩu").fill("mat-khau-sai-123456");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  const alert = page.locator("#auth-error");
  await expect(alert).toContainText("Email hoặc mật khẩu không đúng");
  for (const field of [email, page.getByLabel("Mật khẩu")]) {
    await expect(field).toHaveAttribute("aria-invalid", "true");
    expect(await field.getAttribute("aria-describedby")).toContain(
      "auth-error",
    );
  }
  await expectNoA11yViolations(page, "/login có lỗi");
});

test("UX-A11Y-002: quét axe (có color-contrast) ở theme tối", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/login");
  await expectNoA11yViolations(page, "/login tối");
  await page
    .getByRole("button", { name: "Chưa có tài khoản? Tạo mới" })
    .click();
  await expectNoA11yViolations(page, "/login tạo mới, tối");
});

test("UX-VISUAL-001: prefers-reduced-motion — không animation dịch chuyển/xoay/zoom đang chạy", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  const moving = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((a) => a.playState === "running")
        .filter((a) =>
          ((a as CSSAnimation).effect as KeyframeEffect | null)
            ?.getKeyframes()
            .some((k) => "transform" in k || "translate" in k || "scale" in k),
        ).length,
  );
  expect(moving).toBe(0);
  // Trang tự nó không có animation dịch chuyển: không dựa vào thời gian chuyển để biểu đạt thông tin.
  expect(
    await page.evaluate(() => getComputedStyle(document.body).animationName),
  ).toBe("none");
});

test("UX-DS-006: font có subset tiếng Việt và chuỗi dấu hiển thị bằng font đã tải, không tofu", async ({
  page,
}) => {
  await page.goto("/login");
  const text = "Tiếng Việt có dấu: ắ ầ ẩ ẫ ậ ờ ỡ ợ ừ ữ ự";
  const faces = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].map((f) => ({
      family: f.family,
      range: f.unicodeRange,
      status: f.status,
    }));
  });
  const geist = faces.filter((f) => /geist/i.test(f.family));
  expect(geist.length).toBeGreaterThan(0);
  // subset vietnamese của Google Fonts khai U+1EA0-1EF9 trong unicode-range
  expect(geist.some((f) => /1EA0-1EF9/i.test(f.range))).toBe(true);
  // Render chuỗi dấu và kiểm không có ký tự rơi về ô vuông: đo độ rộng khác nhau giữa ký tự có dấu và ô thay thế.
  const ok = await page.evaluate((s) => {
    const c = document.createElement("canvas").getContext("2d")!;
    c.font = '16px "Geist", system-ui, sans-serif';
    const tofu = c.measureText("�").width;
    return [...s]
      .filter((ch) => ch.trim() !== "")
      .every((ch) => {
        const w = c.measureText(ch).width;
        return w > 0 && (ch === "�" || w !== tofu || /[A-Za-z:]/.test(ch));
      });
  }, text);
  expect(ok).toBe(true);
});
