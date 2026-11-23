import { expect, test } from "@playwright/test";

// Cần DB đã migrate: đặt E2E_DATABASE_URL. Không đặt thì bỏ qua.
test.skip(!process.env.E2E_DATABASE_URL, "cần E2E_DATABASE_URL");

test("/api/health: 200 ok khi CSDL sống, công khai, không cache, không lộ chi tiết @smoke", async ({
  request,
}) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
  expect(res.headers()["cache-control"]).toMatch(/no-store/);
});
