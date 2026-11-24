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
  .filter((l) => /^\|\s*`[a-z_0-9]+\.[a-z_0-9]+`/.test(l))
  .map((l) => l.split("|").map((c) => c.trim()));
const classified = new Set(rows.map((r) => r[1]!.replaceAll("`", "")));

/** Cột của bảng `table` theo migration (khối CREATE TABLE, bỏ ràng buộc). */
function columnsOf(table: string): string[] {
  const m = new RegExp(`CREATE TABLE "${table}" \\(([\\s\\S]*?)\\n\\);`).exec(
    sql,
  );
  if (!m) return [];
  const created = [...m[1]!.matchAll(/^\s*"([a-z_0-9]+)"\s/gm)].map(
    (x) => x[1]!,
  );
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

  it("nói rõ phần chưa làm: hàng chờ yêu cầu của người nhắn tin (DSAR)", () => {
    expect(project).toMatch(/Chưa thực thi/);
    expect(project).toMatch(/hàng chờ DSAR/);
  });
});

const csv = readFileSync("docs/compliance/data-inventory.csv", "utf-8")
  .trim()
  .split("\n")
  .map((l) => l.split(","));
const header = csv[0]!;
const inv = csv.slice(1);
const invIds = new Set(inv.map((r) => r[1]!));

/** Kiểm kê dữ liệu cá nhân (STD-PRIV-002, CMP-PRIV-001): đối chiếu máy với migration và bảng phân loại. */
describe("kiểm kê dữ liệu cá nhân docs/compliance/data-inventory.csv (STD-PRIV-002, CMP-PRIV-001)", () => {
  it("đủ cột; mọi hàng đủ 8 ô, không ô nào rỗng", () => {
    expect(header).toEqual([
      "system",
      "column",
      "class",
      "purpose",
      "legal_basis",
      "retention",
      "copies",
      "recipients",
    ]);
    expect(inv.length).toBeGreaterThan(10);
    for (const r of inv) {
      expect(r.length, r[1]).toBe(8);
      for (const c of r) expect(c.trim().length, r[1]).toBeGreaterThan(0);
    }
  });

  it("mỗi cột trong kiểm kê có thật trong migration; không trùng hàng", () => {
    expect(invIds.size).toBe(inv.length);
    const missing = [...invIds].filter((c) => {
      const [table, col] = c.split(".");
      return !columnsOf(table!).includes(col!);
    });
    expect(missing).toEqual([]);
  });

  it("khớp hai chiều với bảng phân loại trong PROJECT.md: không cột nào thiếu ở một bên", () => {
    expect([...classified].filter((c) => !invIds.has(c))).toEqual([]);
    expect([...invIds].filter((c) => !classified.has(c))).toEqual([]);
  });

  it("lớp trùng với bảng phân loại; cơ sở pháp lý thuộc danh mục đã biết", () => {
    const klass = new Map(rows.map((r) => [r[1]!.replaceAll("`", ""), r[2]!]));
    for (const r of inv) expect(r[2], r[1]).toBe(klass.get(r[1]!));
    const basis = /hợp đồng|lợi ích chính đáng|đồng ý|nghĩa vụ pháp lý/;
    for (const r of inv) expect(r[4], r[1]).toMatch(basis);
  });

  it("cột chứa dữ liệu của người nhắn tin ghi rõ bên kiểm soát và bên nhận AI đám mây có điều kiện đồng ý", () => {
    for (const r of inv.filter((x) => /bên thứ ba/.test(x[2]!)))
      expect(r[4], r[1]).toMatch(/bên kiểm soát/);
    for (const id of ["messages.text", "inbox_items.text"])
      expect(inv.find((r) => r[1] === id)![7]).toMatch(/owner đồng ý/);
  });

  it("thời hạn 365 ngày trong kiểm kê khớp hằng số của job dọn dữ liệu", () => {
    for (const id of ["messages.text", "inbox_items.text", "messages.author"])
      expect(inv.find((r) => r[1] === id)![5]).toContain(
        `${DEFAULT_INBOX_DAYS} ngày`,
      );
  });
});

describe("quyền chủ thể và thời hạn lưu là luồng có mã (STD-PRIV-004/005)", () => {
  it("job dọn dữ liệu có lịch và gọi dịch vụ thời hạn lưu", () => {
    const runner = readFileSync("src/jobs/runner.ts", "utf-8");
    expect(runner).toMatch(/maintenance\.purge-expired/);
    expect(runner).toMatch(/PURGE_CRON = "\d+ \d+ \* \* \*"/);
    expect(runner).toMatch(/retention\.purgeExpired\(/);
  });

  it("ba quyền có test E2E tên rights-access, rights-delete, rights-withdraw-consent", () => {
    const e2e = readFileSync("e2e/rights.spec.ts", "utf-8");
    for (const name of [
      "rights-access",
      "rights-delete",
      "rights-withdraw-consent",
    ])
      expect(e2e).toContain(`test("${name}:`);
    const unit = readFileSync("tests/retention/rights.test.ts", "utf-8");
    for (const name of [
      "rights-access",
      "rights-delete",
      "rights-withdraw-consent",
    ])
      expect(unit).toContain(`describe("${name}:`);
  });
});
