import { describe, expect, it } from "vitest";

import { createDb, DB_TIMEOUTS, poolConfig } from "@/src/db/client";

describe("kết nối CSDL có timeout tường minh (BASE-ERR-004)", () => {
  it("mọi timeout đều là số dương hữu hạn", () => {
    for (const [name, v] of Object.entries(DB_TIMEOUTS)) {
      expect(Number.isFinite(v) && v > 0, name).toBe(true);
    }
  });

  it("poolConfig mang theo timeout và chuỗi kết nối", () => {
    const cfg = poolConfig("postgres://u:p@localhost:5432/db");
    expect(cfg).toMatchObject({
      connectionString: "postgres://u:p@localhost:5432/db",
      connectionTimeoutMillis: DB_TIMEOUTS.connectionTimeoutMillis,
      statement_timeout: DB_TIMEOUTS.statement_timeout,
    });
  });

  it("thiếu DATABASE_URL thì dừng, nêu tên biến", () => {
    expect(() => createDb("")).toThrow(/DATABASE_URL/);
  });
});
