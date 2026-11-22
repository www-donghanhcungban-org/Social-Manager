import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.skip(!process.env.E2E_DATABASE_URL, "cần E2E_DATABASE_URL");

const PASSWORD = "mat-khau-du-dai-123";
const unique = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const VIEWPORTS = [
  { name: "mobile-320", width: 320, height: 800 },
  { name: "desktop-1280", width: 1280, height: 800 },
];

async function checkPage(page: Page, label: string) {
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(" ")}`),
    `axe ${label}`,
  ).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, `cuộn ngang ${label}`).toBeLessThanOrEqual(0);
  const viewport = await page
    .locator('meta[name="viewport"]')
    .getAttribute("content");
  expect(viewport, `meta viewport ${label}`).toContain("width=device-width");
  expect(await page.locator("html").getAttribute("lang")).toBe("vi");
}

for (const vp of VIEWPORTS) {
  test(`a11y + không cuộn ngang ở ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/login");
    await checkPage(page, `${vp.name} /login`);
    await page
      .getByRole("button", { name: "Chưa có tài khoản? Tạo mới" })
      .click();
    await checkPage(page, `${vp.name} /login (tạo mới)`);

    await page.getByLabel("Tên hiển thị").fill("Người thử");
    await page.getByLabel("Email").fill(`${unique()}@example.com`);
    await page.getByLabel("Mật khẩu").fill(PASSWORD);
    await page.getByRole("button", { name: "Tạo tài khoản" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await checkPage(page, `${vp.name} /app`);

    await page.getByLabel(/Tên workspace/).fill("Shop a11y");
    await page.getByRole("button", { name: "Tạo workspace" }).click();
    await expect(page).toHaveURL(/\/app\/[0-9a-f-]{36}$/);
    await checkPage(page, `${vp.name} tổng quan`);

    for (const link of ["Kết nối", "Hộp thư", "Đăng bài"]) {
      await page.getByRole("link", { name: link }).first().click();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await checkPage(page, `${vp.name} ${link}`);
    }

    const notFound = await page.goto("/khong-ton-tai");
    expect(notFound?.status()).toBe(404);
    await checkPage(page, `${vp.name} 404`);
  });
}
