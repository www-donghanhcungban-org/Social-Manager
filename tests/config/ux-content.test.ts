import { existsSync, readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatRelative,
} from "@/src/format/intl";
import {
  BYTES_PER_MIB,
  MS_PER_SECOND,
  mibToBytes,
  msToSeconds,
  secondsToMs,
  unixSecondsToMs,
} from "@/src/format/units";
import { nameKeyOf } from "@/src/db/schema";

const read = (f: string) => readFileSync(f, "utf-8");
const walk = (d: string): string[] =>
  existsSync(d)
    ? readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`],
      )
    : [];
const code = [...walk("app"), ...walk("src")].filter((f) =>
  /\.(ts|tsx)$/.test(f),
);

describe("chuỗi tiếng Việt có dấu (UX-CONTENT-001)", () => {
  it("không còn cụm không dấu hay gặp trong mã giao diện và nguồn", () => {
    const bad =
      /\b(dang nhap|dang ky|khong tim thay|khong co|thanh cong|that bai|mat khau|tai khoan|vui long|xin chao)\b/i;
    const hits = code.filter((f) => bad.test(read(f)));
    expect(hits).toEqual([]);
  });
});

describe("chuẩn hoá NFC (UX-CONTENT-002, XC-I18N-005)", () => {
  const nfd = "Việt Nam".normalize("NFD");
  const nfc = "Việt Nam".normalize("NFC");

  it("NFD và NFC cho cùng một khoá so khớp (một bản ghi)", () => {
    expect(nfd).not.toBe(nfc);
    expect(nameKeyOf(nfd)).toBe(nameKeyOf(nfc));
    expect(nameKeyOf(`  ${nfd}  `)).toBe("việt nam");
  });

  it("mọi dịch vụ nhận văn bản người nhập đều gọi normalize('NFC') ở lớp biên", () => {
    for (const f of [
      "src/posts/service.ts",
      "src/knowledge/service.ts",
      "src/workspaces/service.ts",
      "src/connections/service.ts",
      "src/accounts/service.ts",
      "src/actions/drafts.ts",
      "src/ai/answer.ts",
      "src/auth/password.ts",
    ])
      expect(read(f), f).toContain('normalize("NFC")');
  });
});

describe("định dạng theo locale bằng Intl (XC-I18N-003)", () => {
  const at = new Date("2026-10-13T07:14:05.123Z");

  it("vi-VN: số, tiền, ngày", () => {
    expect(formatNumber(1234567.89, "vi-VN")).toBe("1.234.567,89");
    expect(formatDate(at, "vi-VN")).toBe("13/10/2026");
  });

  it("en-US: số, ngày", () => {
    expect(formatNumber(1234567.89, "en-US")).toBe("1,234,567.89");
    expect(formatDate(at, "en-US")).toBe("10/13/2026");
  });

  it("ngày giờ cố định múi UTC và ghi rõ UTC", () => {
    const s = formatDateTime(at, "vi-VN");
    expect(s).toContain("13/10/2026");
    expect(s).toContain("07:14");
    expect(s.endsWith(" UTC")).toBe(true);
  });

  it("thời gian tương đối theo locale", () => {
    const now = at.getTime();
    expect(formatRelative(now - 2 * 3600 * MS_PER_SECOND, now, "vi-VN")).toBe(
      "2 giờ trước",
    );
    expect(formatRelative(now, now, "en-US")).toBe("now");
  });

  it("lớp UI không dùng toFixed( hay toLocaleDateString() không tham số", () => {
    const bad = code.filter((f) =>
      /\.toFixed\(|\.toLocaleDateString\(\s*\)|\.toLocaleTimeString\(\s*\)/.test(
        read(f),
      ),
    );
    expect(bad).toEqual([]);
  });
});

describe("thời điểm UTC (XC-UNITS-001)", () => {
  it("không có timestamp không múi giờ ở schema và migration", () => {
    const schema = read("src/db/schema.ts");
    const all = (schema.match(/timestamp\(/g) ?? []).length;
    const tz = (schema.match(/withTimezone: true/g) ?? []).length;
    expect(all).toBeGreaterThan(0);
    expect(tz).toBe(all);
    for (const f of walk("drizzle").filter((x) => x.endsWith(".sql")))
      expect(read(f), f).not.toMatch(/timestamp without time zone/i);
  });

  it("API đăng bài từ chối chuỗi giờ không có offset", () => {
    expect(read("src/posts/service.ts")).toContain("parseIsoWithOffset");
  });
});

describe("đơn vị trong tên và hằng số đổi tập trung (XC-UNITS-009)", () => {
  it("không có `* 1000` hay `/ 1024` ngoài src/format/units.ts", () => {
    const bad = code
      .filter((f) => f !== "src/format/units.ts")
      .filter((f) => /\* ?1000\b|\/ ?1024\b/.test(read(f)));
    expect(bad).toEqual([]);
  });

  it("hàm đổi đơn vị đúng ca biên", () => {
    expect(secondsToMs(0)).toBe(0);
    expect(secondsToMs(1.5)).toBe(1500);
    expect(msToSeconds(999)).toBe(0);
    expect(msToSeconds(1000)).toBe(1);
    expect(unixSecondsToMs(1)).toBe(1000);
    expect(mibToBytes(1)).toBe(BYTES_PER_MIB);
  });

  it("cột số trong schema mang đơn vị trong tên hoặc nằm trong danh sách đếm không thứ nguyên", () => {
    const dimensionless = new Set([
      "consecutive_failures",
      "item_count",
      "current_version",
      "version",
      "draft_version",
      "attempts",
      "failures",
    ]);
    const unit = /_(bytes|days|hours|ms|s|percent|per_hour|per_day)$|^bytes_/;
    const cols = [
      ...read("src/db/schema.ts").matchAll(
        /(?:integer|bigint|real|numeric)\("([a-z0-9_]+)"/g,
      ),
    ].map((m) => m[1]!);
    expect(cols.length).toBeGreaterThan(5);
    const bad = cols.filter((c) => !unit.test(c) && !dimensionless.has(c));
    expect(bad).toEqual([]);
  });
});

describe("biên lỗi không lộ chi tiết nội bộ (UX-STATE-005)", () => {
  const boundaries = [
    "app/error.tsx",
    "app/global-error.tsx",
    "app/app/[workspaceId]/error.tsx",
  ];

  it("mỗi biên lỗi chỉ hiện digest, có nút Thử lại gọi reset", () => {
    for (const f of boundaries) {
      const t = read(f);
      expect(t, f).not.toMatch(/error\.(message|stack|name|cause)/);
      expect(t, f).toContain("error.digest");
      expect(t, f).toContain("Thử lại");
      expect(t, f).toMatch(/onClick=\{reset\}/);
    }
  });

  it("trang trong workspace có trạng thái đang tải và biên lỗi riêng", () => {
    expect(existsSync("app/app/[workspaceId]/loading.tsx")).toBe(true);
    expect(existsSync("app/app/[workspaceId]/error.tsx")).toBe(true);
  });
});
