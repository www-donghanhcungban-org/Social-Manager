import { describe, expect, it } from "vitest";

import { createAuthFromEnv } from "@/src/auth/server";

const ENV = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  BETTER_AUTH_SECRET: "x".repeat(48),
  BETTER_AUTH_URL: "http://localhost:3000",
};

describe("createAuthFromEnv", () => {
  it("đủ biến môi trường thì dựng được auth (chưa nối DB tới khi có truy vấn)", () => {
    expect(createAuthFromEnv(ENV).api).toBeDefined();
  });

  it.each([
    ["DATABASE_URL", /DATABASE_URL/],
    ["BETTER_AUTH_SECRET", /secret/i],
    ["BETTER_AUTH_URL", /BETTER_AUTH_URL/],
  ])("thiếu %s thì dừng và nói rõ thiếu gì", (name, message) => {
    const env: Record<string, string | undefined> = {
      ...ENV,
      [name]: undefined,
    };
    expect(() => createAuthFromEnv(env)).toThrow(message);
  });

  it("để trống DATABASE_URL cũng bị từ chối, không rơi về giá trị mặc định", () => {
    expect(() => createAuthFromEnv({ ...ENV, DATABASE_URL: "" })).toThrow(
      /DATABASE_URL/,
    );
  });
});
