import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DEFAULT_INBOX_DAYS } from "@/src/retention/service";

const project = readFileSync("PROJECT.md", "utf-8");
const sql = execFileSync("git", ["ls-files", "-z", "drizzle"], {
  encoding: "utf-8",
})
  .split("\0")
  .filter((f) => /^drizzle\/\d+_.*\.sql$/.test(f) && !f.endsWith(".down.sql"))
  .map((f) => readFileSync(f, "utf-8"))
  .join("\n");

const section = project
  .split("### Phân loại dữ liệu cá nhân và nhạy cảm (BASE-SEC-013)")[1]!
  .split("\n## ")[0]!;
const rows = section
  .split("\n")
  .filter((l) => /^\|\s*`[a-z_]+\.[a-z_]+`/.test(l))
  .map((l) => l.split("|").map((c) => c.trim()));
const classified = new Set(rows.map((r) => r[1]!.replaceAll("`", "")));

/** Cột của bảng `table` theo migration (khối CREATE TABLE, bỏ ràng buộc). */
function columnsOf(table: string): string[] {
  const m = new RegExp(`CREATE TABLE "${table}" \\(([\\s\\S]*?)\\n\\);`).exec(
    sql,
  );
  if (!m) return [];
  const created = [...m[1]!.matchAll(/^\s*"([a-z_]+)"\s/gm)].map((x) => x[1]!);
  // cột thêm sau bằng migration `ALTER TABLE … ADD COLUMN`
  const added = [
    ...sql.matchAll(
      new RegExp(`ALTER TABLE "${table}" ADD COLUMN "([a-z_]+)"`, "g"),
    ),
  ].map((x) => x[1]!);
  return [...created, ...added];
}

describe("phân loại dữ liệu cá nhân/nhạy cảm (BASE-SEC-013)", () => {
  it("mỗi cột trong bảng phân loại có thật trong migration", () => {
    expect(rows.length).toBeGreaterThan(10);
    const missing = [...classified].filter((c) => {
      const [table, col] = c.split(".");
      return !columnsOf(table!).includes(col!);
    });
    expect(missing).toEqual([]);
  });

  it("mỗi hàng có lớp, lý do, cách bảo vệ và thời hạn lưu", () => {
    for (const r of rows) {
      for (const i of [2, 3, 4, 5])
        expect(r[i]!.length, `${r[1]} cột ${i}`).toBeGreaterThan(1);
    }
  });

  it("mọi cột có tên thuộc nhóm nhạy cảm trong schema đều đã được phân loại", () => {
    const tables = [...sql.matchAll(/CREATE TABLE "([a-z_]+)"/g)].map(
      (m) => m[1]!,
    );
    const sensitive =
      /^(email|password|token|ip_address|user_agent|author|text|participant_id|participant_name|access_token|refresh_token|id_token|display_name|[a-z_]+_enc)$/;
    // Đã giải thích riêng trong PROJECT.md (cột OAuth không dùng) hoặc không phải dữ liệu cá nhân:
    const documentedElsewhere = new Set([
      "account.access_token",
      "account.refresh_token",
      "account.id_token",
      "posts.text", // nội dung bài do người dùng tự soạn để đăng công khai
    ]);
    const unclassified: string[] = [];
    for (const t of tables)
      for (const c of columnsOf(t)) {
        const id = `${t}.${c}`;
        if (
          sensitive.test(c) &&
          !classified.has(id) &&
          !documentedElsewhere.has(id)
        )
          unclassified.push(id);
      }
    expect(unclassified).toEqual([]);
    for (const id of documentedElsewhere.keys())
      if (id.startsWith("account."))
        expect(project).toContain(id.split(".")[1]);
  });

  it("thời hạn lưu trong bảng khớp với hằng số của job dọn dữ liệu", () => {
    const inboxRows = rows.filter((r) =>
      /^`(inbox_items|messages|conversations)\./.test(r[1]!),
    );
    expect(inboxRows.length).toBeGreaterThan(0);
    for (const r of inboxRows)
      expect(r[5], r[1]).toContain(`${DEFAULT_INBOX_DAYS} ngày`);
    expect(project).toContain("maintenance.purge-expired");
  });

  it("nói rõ phần chưa làm: xoá dữ liệu theo yêu cầu của chủ dữ liệu", () => {
    expect(project).toMatch(/Chưa thực thi/);
  });
});
