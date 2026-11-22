import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { loadEnv } from "@/src/config/env";
import { createContainer } from "@/src/server/container";

const env = () =>
  loadEnv({
    DATABASE_URL: "postgres://u:p@localhost:5432/db",
    BETTER_AUTH_SECRET: "x".repeat(40),
    BETTER_AUTH_URL: "http://localhost:3000",
    APP_SECRET_KEY: randomBytes(32).toString("base64"),
  });

describe("createContainer", () => {
  it("dựng đủ dịch vụ mà không nối DB ngay (pool nối lười)", async () => {
    const c = createContainer(env());
    expect(Object.keys(c.services).sort()).toEqual([
      "accounts",
      "connections",
      "coverage",
      "erasure",
      "evidence",
      "inbox",
      "knowledge",
      "posts",
      "retention",
      "search",
      "webhooks",
      "workspaces",
    ]);
    await c.close();
  });

  it("resolveProvider dựng đúng provider theo id; id lạ trả undefined", async () => {
    const c = createContainer(env());
    expect(c.resolveProvider("demo", "bất-kỳ")?.id).toBe("demo");
    expect(c.resolveProvider("socialapi", "sk-key")?.id).toBe("socialapi");
    expect(c.resolveProvider("khong-co", "k")).toBeUndefined();
    await c.close();
  });

  it("registry liệt kê demo và socialapi để kiểm kết nối hợp lệ", async () => {
    const c = createContainer(env());
    expect(c.registry.list().map((p) => p.id)).toEqual(["demo", "socialapi"]);
    await c.close();
  });

  it("RUN_WORKERS mặc định true, hiểu được false", () => {
    expect(env().RUN_WORKERS).toBe("true");
    expect(
      loadEnv({
        DATABASE_URL: "postgres://u:p@localhost:5432/db",
        BETTER_AUTH_SECRET: "x".repeat(40),
        BETTER_AUTH_URL: "http://localhost:3000",
        APP_SECRET_KEY: randomBytes(32).toString("base64"),
        RUN_WORKERS: "false",
      }).RUN_WORKERS,
    ).toBe("false");
  });
});
