import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { expectNoA11yViolations } from "./helpers/a11y";

test.skip(!process.env.E2E_DATABASE_URL, "cần E2E_DATABASE_URL");

const PASSWORD = "mat-khau-du-dai-123";

async function signUp(page: Page, email: string) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Chưa có tài khoản? Tạo mới" })
    .click();
  await page.getByLabel("Tên hiển thị").fill("Người thử");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(PASSWORD);
  await page.getByRole("button", { name: "Tạo tài khoản" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByLabel(/Tên workspace/).fill("Quyền dữ liệu");
  await page.getByRole("button", { name: "Tạo workspace" }).click();
  await expect(page).toHaveURL(/\/app\/[0-9a-f-]{36}$/);
}

test("rights-access: tải dữ liệu của chính mình, không lộ mật khẩu hay mã phiên", async ({
  page,
}) => {
  const email = `rights-${randomUUID()}@example.com`;
  await signUp(page, email);
  await page.getByRole("link", { name: "Tài khoản" }).click();
  await expect(page).toHaveURL(/\/app\/account$/);
  await expectNoA11yViolations(page, "/app/account");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Tải dữ liệu của tôi" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("du-lieu-cua-toi.json");
  const path = await file.path();
  const { readFileSync } = await import("node:fs");
  const text = readFileSync(path, "utf-8");
  const data = JSON.parse(text) as {
    profile: { email: string };
    memberships: { workspaceName: string; role: string }[];
  };
  expect(data.profile.email).toBe(email);
  expect(data.memberships).toEqual([
    expect.objectContaining({ workspaceName: "Quyền dữ liệu", role: "owner" }),
  ]);
  expect(text).not.toMatch(/argon2|"token"|"password"/i);

  // Chưa đăng nhập thì không tải được.
  const anon = await page.context().browser()!.newContext();
  const res = await anon.request.post(
    new URL("/app/account/export", page.url()).toString(),
  );
  expect(res.status()).toBe(401);
  await anon.close();
});

test("rights-withdraw-consent: cấp rồi rút đồng ý AI đám mây ở cùng một chỗ, cùng một nút", async ({
  page,
}) => {
  await signUp(page, `rights-${randomUUID()}@example.com`);
  const state = page.locator("[data-consent-state]");
  await expect(page.locator("[data-consent-text]")).toContainText("AI đám mây");
  await expect(state).toContainText("chưa đồng ý");

  await page.getByRole("button", { name: "Đồng ý và bật AI đám mây" }).click();
  await expect(state).toContainText("đã đồng ý");
  await expect(
    page.getByRole("list", { name: "Lịch sử đồng ý" }),
  ).toContainText("Đồng ý lúc");

  await page.getByRole("button", { name: "Rút đồng ý" }).click();
  await expect(state).toContainText("chưa đồng ý");
  const history = page.getByRole("list", { name: "Lịch sử đồng ý" });
  await expect(history).toContainText("Rút đồng ý lúc");
  await expect(history).toContainText("Đồng ý lúc");
});

test("rights-delete: sai mật khẩu bị từ chối; đúng thì xoá tài khoản và không đăng nhập lại được", async ({
  page,
}) => {
  const email = `rights-${randomUUID()}@example.com`;
  await signUp(page, email);
  await page.getByRole("link", { name: "Tài khoản" }).click();

  await page
    .getByLabel("Nhập lại mật khẩu để xác nhận")
    .fill("sai-mat-khau-12345");
  await page.getByLabel(/Tôi hiểu việc xoá/).check();
  await page.getByRole("button", { name: "Xoá tài khoản" }).click();
  await expect(
    page.getByRole("region", { name: "Xoá tài khoản" }).getByRole("alert"),
  ).toContainText("Mật khẩu không đúng");
  await expect(page).toHaveURL(/\/app\/account$/);

  // Biểu mẫu được đặt lại sau mỗi lần gửi: nhập lại cả mật khẩu và ô xác nhận.
  await page.getByLabel("Nhập lại mật khẩu để xác nhận").fill(PASSWORD);
  await page.getByLabel(/Tôi hiểu việc xoá/).check();
  await page.getByRole("button", { name: "Xoá tài khoản" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("#auth-error")).toContainText(
    "Email hoặc mật khẩu không đúng",
  );
});
