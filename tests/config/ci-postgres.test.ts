import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// AUD-HAR-005: test tích hợp Postgres (race khoá workspace, pg-boss) tự `describe.skip` khi thiếu
// TEST_DATABASE_URL. Nếu CI không cấp biến này thì chúng bị bỏ qua mà CI vẫn xanh.
describe("test tích hợp Postgres phải chạy ở CI (AUD-HAR-005)", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf-8");
  const gateJob = ci.slice(ci.indexOf("\n  gate:"), ci.indexOf("\n  e2e:"));

  it("job gate có service Postgres ghim digest và đặt TEST_DATABASE_URL", () => {
    expect(gateJob).toMatch(/services:\s*\n\s+postgres:/);
    expect(gateJob).toMatch(/image: postgres:[\w.-]+@sha256:[0-9a-f]{64}/);
    expect(gateJob).toMatch(/TEST_DATABASE_URL:\s*postgres:\/\//);
  });

  // Chạy trong CI (GitHub đặt CI=true): thiếu biến nghĩa là hai test tích hợp đang bị skip.
  it.runIf(process.env.CI === "true")(
    "khi chạy trong CI, TEST_DATABASE_URL phải được đặt",
    () => {
      expect(process.env.TEST_DATABASE_URL).toBeTruthy();
    },
  );
});
