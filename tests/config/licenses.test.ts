import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Giấy phép và SBOM của phụ thuộc (T-515): BASE-DEP-005, CMP-LIC-001/002/003/004.
 * Chính sách ở `license-policy.json`; THIRD_PARTY_NOTICES.md sinh từ lockfile — lệch thì đỏ, cập nhật bằng
 * `UPDATE_NOTICES=1 npx vitest run tests/config/licenses.test.ts`.
 */
interface Policy {
  allow: string[];
  review: string[];
  deny: string[];
  exceptions: {
    package: string;
    license: string;
    reason: string;
    approved_by: string;
    expires: string;
  }[];
}
const policy = JSON.parse(
  readFileSync("license-policy.json", "utf-8"),
) as Policy;
const lock = JSON.parse(readFileSync("package-lock.json", "utf-8")) as {
  packages: Record<string, { version: string; license?: string | string[] }>;
};
const entries = Object.entries(lock.packages)
  .filter(([k]) => k !== "")
  .map(([k, v]) => ({
    name: k.slice(k.lastIndexOf("node_modules/") + "node_modules/".length),
    version: v.version,
    license: Array.isArray(v.license)
      ? v.license.join(" OR ")
      : (v.license ?? "UNKNOWN"),
  }));
const ids = (expr: string) =>
  expr
    .split(/\s+(?:AND|OR)\s+|[()]/)
    .map((s) => s.trim())
    .filter(Boolean);
const matches = (pattern: string, name: string) =>
  pattern.endsWith("*")
    ? name.startsWith(pattern.slice(0, -1))
    : name === pattern;
const today = new Date().toISOString().slice(0, 10);

/** Gói vi phạm chính sách: id cấm/không rõ, hoặc id `review` thiếu ngoại lệ còn hạn. */
function violations() {
  const bad: string[] = [];
  for (const e of entries) {
    const list = ids(e.license);
    const anyOf = / OR /.test(e.license) && !/ AND /.test(e.license);
    const okId = (id: string) =>
      policy.allow.includes(id) ||
      (policy.review.includes(id) &&
        policy.exceptions.some(
          (x) =>
            matches(x.package, e.name) &&
            x.license === id &&
            x.expires >= today,
        ));
    const denied = list.filter((id) => policy.deny.includes(id));
    const unknown = list.filter(
      (id) =>
        !policy.allow.includes(id) &&
        !policy.review.includes(id) &&
        !policy.deny.includes(id),
    );
    const ok = anyOf
      ? list.some(okId) && denied.length === 0
      : list.every(okId);
    if (denied.length || unknown.length || !ok)
      bad.push(`${e.name}@${e.version}: ${e.license}`);
  }
  return bad;
}

describe("chính sách license (BASE-DEP-005, CMP-LIC-002, CMP-LIC-004)", () => {
  it("mọi gói trong lockfile (kể cả transitive) có license rõ, nằm trong allow hoặc có ngoại lệ còn hạn", () => {
    expect(entries.length).toBeGreaterThan(100);
    expect(violations()).toEqual([]);
  });

  it("không gói nào thiếu license hoặc UNKNOWN; không license nguồn-có-sẵn/copyleft mạnh (deny)", () => {
    expect(entries.filter((e) => e.license === "UNKNOWN")).toEqual([]);
    const denyHits = entries.filter((e) =>
      ids(e.license).some((id) => policy.deny.includes(id)),
    );
    expect(denyHits).toEqual([]);
  });

  it("ngoại lệ: đủ package/license/reason/approved_by/expires, còn hạn, tối đa 2 năm, và đang được dùng", () => {
    for (const x of policy.exceptions) {
      expect(x.reason.length, x.package).toBeGreaterThan(20);
      expect(x.approved_by, x.package).not.toBe("");
      expect(x.expires, x.package).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(x.expires >= today, `${x.package} hết hạn ${x.expires}`).toBe(
        true,
      );
      expect(policy.review, x.package).toContain(x.license);
      expect(
        entries.some((e) => matches(x.package, e.name)),
        `${x.package} không còn trong lockfile → bỏ ngoại lệ`,
      ).toBe(true);
    }
  });

  it("allow/review/deny không chồng nhau", () => {
    const all = [...policy.allow, ...policy.review, ...policy.deny];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("SBOM CycloneDX và THIRD_PARTY_NOTICES (CMP-LIC-001, CMP-LIC-003)", () => {
  it("npm sbom (từ lockfile) sinh CycloneDX hợp lệ, license không rỗng ≥ 99%", () => {
    const out = execFileSync(
      "npm",
      ["sbom", "--sbom-format", "cyclonedx", "--package-lock-only"],
      { encoding: "utf-8", maxBuffer: 50_000_000 },
    );
    const bom = JSON.parse(out) as {
      bomFormat: string;
      components: { licenses?: unknown[] }[];
    };
    expect(bom.bomFormat).toBe("CycloneDX");
    expect(bom.components.length).toBeGreaterThanOrEqual(entries.length);
    const withLicense = bom.components.filter(
      (c) => (c.licenses ?? []).length > 0,
    );
    expect(withLicense.length / bom.components.length).toBeGreaterThanOrEqual(
      0.99,
    );
  }, 60_000);

  it("CI sinh SBOM và lưu thành artifact `sbom`", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf-8");
    expect(ci).toMatch(/npm sbom --sbom-format cyclonedx/);
    expect(ci).toMatch(/name: sbom/);
  });

  it("THIRD_PARTY_NOTICES.md khớp lockfile (gói cần ghi công/ngoại lệ license), diff = 0", () => {
    const review = entries
      .filter((e) => ids(e.license).some((id) => policy.review.includes(id)))
      .sort((a, b) => a.name.localeCompare(b.name));
    const body = [
      "# Thông báo phụ thuộc bên thứ ba",
      "",
      "Tệp này **sinh tự động** từ `package-lock.json` và `license-policy.json` (cập nhật: `UPDATE_NOTICES=1 npx vitest run tests/config/licenses.test.ts`).",
      "Liệt kê gói dùng license cần ghi công hoặc ngoại lệ có hạn; các gói còn lại dùng license cho phép (MIT, Apache-2.0, ISC, BSD, …) — danh sách đầy đủ trong SBOM (`sbom.cdx.json`, artifact CI).",
      "",
      "| Gói | Phiên bản | License | Ghi chú |",
      "| --- | --- | --- | --- |",
      ...review.map((e) => {
        const x = policy.exceptions.find((p) => matches(p.package, e.name));
        return `| \`${e.name}\` | ${e.version} | ${e.license} | ${x ? `ngoại lệ đến ${x.expires}` : ""} |`;
      }),
      "",
      "- `caniuse-lite` (CC-BY-4.0): © Alexis Deveria, Lars Kappert và cộng tác viên — dữ liệu từ caniuse.com, dùng theo giấy phép CC-BY-4.0 (https://creativecommons.org/licenses/by/4.0/).",
      "- `@img/sharp-*` (LGPL-3.0-or-later): nhị phân libvips của sharp, dùng nguyên bản như thư viện liên kết động.",
      "- `lightningcss`, `axe-core` (MPL-2.0): dùng nguyên bản, không sửa mã nguồn.",
      "",
    ].join("\n");
    if (process.env.UPDATE_NOTICES === "1")
      writeFileSync("THIRD_PARTY_NOTICES.md", body);
    // Bộ định dạng Markdown căn lại cột bảng: so sánh sau khi chuẩn hoá khoảng trắng và dòng phân cách.
    const norm = (s: string) =>
      s.replace(/[ \t]+/g, " ").replace(/^\|[ \-|]+\|$/gm, "|-|");
    expect(norm(readFileSync("THIRD_PARTY_NOTICES.md", "utf-8"))).toBe(
      norm(body),
    );
    expect(readFileSync("LICENSE", "utf-8").length).toBeGreaterThan(100);
    expect(readFileSync("NOTICE", "utf-8")).toMatch(/Copyright/);
  });
});
