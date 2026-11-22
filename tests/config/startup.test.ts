import { describe, expect, it } from "vitest";

import { processEnv, shouldValidateAtStartup } from "@/src/config/env";

describe("shouldValidateAtStartup", () => {
  it("kiểm khi chạy server Node thật", () => {
    expect(shouldValidateAtStartup({ NEXT_RUNTIME: "nodejs" })).toBe(true);
  });

  it("bỏ qua khi `next build` (build không cần bí mật)", () => {
    expect(
      shouldValidateAtStartup({
        NEXT_RUNTIME: "nodejs",
        NEXT_PHASE: "phase-production-build",
      }),
    ).toBe(false);
  });

  it("bỏ qua ngoài runtime Node (edge) hoặc khi không biết runtime", () => {
    expect(shouldValidateAtStartup({ NEXT_RUNTIME: "edge" })).toBe(false);
    expect(shouldValidateAtStartup({})).toBe(false);
  });
});

describe("processEnv", () => {
  it("trả đúng process.env của tiến trình", () => {
    expect(processEnv()).toBe(process.env);
  });
});
