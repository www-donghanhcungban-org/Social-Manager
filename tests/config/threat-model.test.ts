import { existsSync, readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const doc = readFileSync("docs/THREAT-MODEL.md", "utf-8");

/** Các hàng của bảng STRIDE (mục 4): cột theo thứ tự của mẫu khung. */
const section4 = doc
  .split("## 4. Mối đe doạ theo luồng (STRIDE)")[1]!
  .split("## 5.")[0]!;
const rows = section4
  .split("\n")
  .filter((l) => /^\|\s*TM-\d+/.test(l))
  .map((l) => l.split("|").map((c) => c.trim()));

describe("THREAT-MODEL.md (BASE-SEC-011)", () => {
  it("có đủ các mục bắt buộc của mẫu", () => {
    for (const h of [
      "## 1. Tài sản",
      "## 2. Thành phần, ranh giới tin cậy, luồng dữ liệu",
      "## 3. Kẻ tấn công giả định",
      "## 4. Mối đe doạ theo luồng (STRIDE)",
      "## 5. Giả định và chấp nhận rủi ro",
      "## 6. Hành động còn mở",
    ])
      expect(doc).toContain(h);
  });

  it("có mối đe doạ cho cả sáu loại STRIDE", () => {
    const text = rows.map((r) => r[3]).join(" ");
    for (const k of [
      "Spoofing",
      "Tampering",
      "Repudiation",
      "Information disclosure",
      "Denial of service",
      "Elevation of privilege",
    ])
      expect(text, k).toContain(k);
  });

  it("mỗi mối đe doạ mức Cao có biện pháp, bằng chứng và trạng thái", () => {
    const high = rows.filter((r) => r[5] === "Cao");
    expect(high.length).toBeGreaterThan(5);
    for (const r of high) {
      expect(r[7]!.length, `${r[1]} thiếu biện pháp`).toBeGreaterThan(10);
      expect(r[8], `${r[1]} thiếu bằng chứng`).toMatch(/`/);
      expect(r[9], `${r[1]} thiếu trạng thái`).toMatch(
        /đã giảm|một phần|chấp nhận/,
      );
    }
  });

  it("mọi tệp/thư mục trong cột bằng chứng đều tồn tại", () => {
    const missing: string[] = [];
    for (const r of rows) {
      for (const m of r[8]!.matchAll(/`([^`]+)`/g)) {
        const path = m[1]!.split(/\s/)[0]!;
        if (/^(tests|e2e|\.github|src|app)\//.test(path) && !existsSync(path))
          missing.push(`${r[1]}: ${path}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("mối đe doạ chưa giảm hết đều có việc ở mục 6", () => {
    const open = rows.filter((r) => r[9] === "một phần").map((r) => r[1]!);
    const section6 = doc.split("## 6. Hành động còn mở")[1]!;
    for (const id of open) expect(section6, id).toContain(id);
  });

  it("SEC-TM-001: frontmatter `updated` không cũ hơn ADR mới nhất", () => {
    const updated = /^updated:\s*(\d{4}-\d{2}-\d{2})/m.exec(doc)?.[1];
    expect(updated).toBeDefined();
    const newest = readdirSync("docs/adr")
      .filter((f) => /^\d{4}-.*\.md$/.test(f) && !f.startsWith("0000-"))
      .map(
        (f) =>
          /^date:\s*(\d{4}-\d{2}-\d{2})/m.exec(
            readFileSync(`docs/adr/${f}`, "utf-8"),
          )?.[1] ?? "",
      )
      .sort()
      .at(-1)!;
    expect(newest).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(updated! >= newest, `${updated} < ${newest}`).toBe(true);
  });

  it("SEC-TM-003: DFD Mermaid có ranh giới tin cậy và mọi tích hợp ngoài trong cấu hình môi trường", () => {
    const m = /```mermaid\n([\s\S]*?)```/.exec(doc)?.[1] ?? "";
    expect(m).toMatch(/^flowchart/m);
    expect(m).toMatch(/subgraph TB1/);
    expect(m).toMatch(/subgraph TB2/);
    for (const k of [
      "SocialAPI",
      "GitHub",
      "AI_BASE_URL",
      "PostgreSQL",
      "blobdata",
      "Trình duyệt",
      "Cổng AI",
    ])
      expect(m, k).toContain(k);
    // Ranh giới nội dung ngoài↔LLM và agent↔tool nêu rõ.
    expect(doc).toMatch(/TB4/);
    expect(doc).toMatch(/agent↔tool/);
    for (const v of [
      "SOCIALAPI_BASE_URL",
      "AI_BASE_URL",
      "BLOB_DIR",
      "DATABASE_URL",
    ])
      expect(doc, v).toContain(v);
  });

  it("SEC-TM-005/006: mỗi hàng có mức và quyết định hợp lệ; không hàng Cao nào ở quyết định accept", () => {
    expect(rows.length).toBeGreaterThanOrEqual(20);
    for (const r of rows) {
      expect(r[5], `${r[1]} mức`).toMatch(/^(Cao|TB|Thấp)$/);
      expect(r[6], `${r[1]} quyết định`).toMatch(
        /^(mitigate|eliminate|transfer|accept)$/,
      );
      if (r[5] === "Cao")
        expect(r[6], `${r[1]} Cao không được accept`).not.toBe("accept");
    }
    // Hàng accept khớp trạng thái chấp nhận.
    for (const r of rows.filter((r) => r[6] === "accept"))
      expect(r[9]).toBe("chấp nhận");
  });

  it("STD-SEC-003: bảng OWASP Top 10:2025 đủ A01–A10 với biện pháp", () => {
    expect(
      (doc.match(/A(0[1-9]|10):2025/g) ?? []).length,
    ).toBeGreaterThanOrEqual(10);
    const section = doc.split("## 4b.")[1]!.split("## 5.")[0]!;
    for (let i = 1; i <= 10; i++) {
      const id = `A${String(i).padStart(2, "0")}:2025`;
      const row = section.split("\n").find((l) => l.includes(`| ${id}`));
      expect(row, id).toBeDefined();
      expect(
        row!.split("|")[3]!.trim().length,
        `${id} biện pháp`,
      ).toBeGreaterThan(15);
    }
  });
});
