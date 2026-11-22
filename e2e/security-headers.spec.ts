import { expect, test } from "@playwright/test";

test("trang đăng nhập có header bảo mật, không vi phạm CSP và vẫn hydrate (PRF-WEB-007)", async ({
  page,
}) => {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" || /content security policy/i.test(m.text()))
      problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(e.message));

  const res = await page.goto("/login");
  const h = res!.headers();
  expect(h["content-security-policy"]).toMatch(/script-src[^;]*'nonce-/);
  expect(h["content-security-policy"]).not.toMatch(
    /script-src[^;]*unsafe-inline/,
  );
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["cache-control"]).toBe("private, no-store");

  await page.waitForLoadState("networkidle");
  expect(problems).toEqual([]);

  // Chuyển chế độ chỉ chạy khi JS đã hydrate: chứng minh script có nonce thực sự chạy.
  await page.getByRole("button", { name: /Chưa có tài khoản/ }).click();
  await expect(
    page.getByRole("heading", { name: "Tạo tài khoản" }),
  ).toBeVisible();
  expect(problems).toEqual([]);
});

test("tài nguyên tĩnh không bị ép private/no-store", async ({ request }) => {
  const res = await request.get("/favicon.ico");
  expect(res.headers()["cache-control"] ?? "").not.toContain("no-store");
});

test("POST cross-site bị từ chối 403, cùng nguồn không bị chặn bởi lớp CSRF (SEC-WEB-007)", async ({
  request,
}) => {
  const attempts: Record<string, string>[] = [
    { "sec-fetch-site": "cross-site" },
    { origin: "https://evil.example" },
  ];
  for (const headers of attempts) {
    const res = await request.post("/api/auth/sign-out", { headers });
    expect(res.status(), JSON.stringify(headers)).toBe(403);
  }
  const ok = await request.post("/api/auth/sign-out", {
    headers: { "sec-fetch-site": "same-origin" },
  });
  expect(ok.status()).not.toBe(403);
});
