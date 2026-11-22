import { existsSync, readFileSync } from "node:fs";

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
      expect(r[6]!.length, `${r[1]} thiếu biện pháp`).toBeGreaterThan(10);
      expect(r[7], `${r[1]} thiếu bằng chứng`).toMatch(/`/);
      expect(r[8], `${r[1]} thiếu trạng thái`).toMatch(
        /đã giảm|một phần|chấp nhận/,
      );
    }
  });

  it("mọi tệp/thư mục trong cột bằng chứng đều tồn tại", () => {
    const missing: string[] = [];
    for (const r of rows) {
      for (const m of r[7]!.matchAll(/`([^`]+)`/g)) {
        const path = m[1]!.split(/\s/)[0]!;
        if (/^(tests|e2e|\.github|src|app)\//.test(path) && !existsSync(path))
          missing.push(`${r[1]}: ${path}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("mối đe doạ chưa giảm hết đều có việc ở mục 6", () => {
    const open = rows.filter((r) => r[8] === "một phần").map((r) => r[1]!);
    const section6 = doc.split("## 6. Hành động còn mở")[1]!;
    for (const id of open) expect(section6, id).toContain(id);
  });
});
