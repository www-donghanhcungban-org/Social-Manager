import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { workspaces } from "@/src/db/schema";

import { createTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.client.close();
});

describe("CSDL lưu và đọc lại UTF-8 nguyên vẹn (BASE-DATA-001)", () => {
  it("tiếng Việt, emoji và cờ (chuỗi nhiều điểm mã) không đổi sau khi lưu", async () => {
    const samples = [
      "Tiếng Việt 🇻🇳",
      "Cà phê ☕ — quán Ông Tư",
      "日本語 · العربية · Ελληνικά",
      "é", // ký tự tổ hợp: DB không được tự đổi dạng chuẩn hoá
    ];
    for (const name of samples) {
      const [row] = await t.db.insert(workspaces).values({ name }).returning();
      expect(row!.name).toBe(name);
    }
    const stored = (await t.db.select().from(workspaces)).map((r) => r.name);
    expect(stored.sort()).toEqual([...samples].sort());
  });

  it("máy chủ báo bảng mã UTF8", async () => {
    const r = await t.client.query<{ server_encoding: string }>(
      "show server_encoding",
    );
    expect(r.rows[0]!.server_encoding).toBe("UTF8");
  });
});
