import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf-8");

describe("README (BASE-DOC-001)", () => {
  const readme = read("README.md");
  const headings = readme
    .split("\n")
    .filter((l) => l.startsWith("## "))
    .map((l) => l.slice(3).trim());

  it.each([
    "Yêu cầu môi trường",
    "Cài và chạy",
    "Chạy test",
    "Cấu hình",
    "Đóng góp và liên hệ",
    "License",
  ])("có mục %s", (h) => {
    expect(headings).toContain(h);
  });

  it("mở đầu bằng mô tả sản phẩm, không còn lời mẫu create-next-app", () => {
    expect(readme).not.toMatch(/create-next-app/);
    expect(readme.split("\n")[0]).toBe("# Social Manager");
  });
});

describe("tệp cộng đồng và phát hành", () => {
  it("CHANGELOG có [Unreleased] ở đầu (BASE-REPO-007)", () => {
    const first = read("CHANGELOG.md")
      .split("\n")
      .find((l) => l.startsWith("## "));
    expect(first).toBe("## [Unreleased]");
  });

  it("LICENSE tồn tại và package.json khai license SPDX khớp (BASE-REPO-004)", () => {
    expect(existsSync("LICENSE")).toBe(true);
    const pkg = JSON.parse(read("package.json")) as { license: string };
    expect(pkg.license).toBe("MIT");
    expect(read("LICENSE")).toMatch(/^MIT License/);
  });

  it("SECURITY.md nêu kênh báo lỗ hổng (BASE-SEC-009)", () => {
    expect(read("SECURITY.md")).toMatch(/Report a vulnerability/);
  });

  it("`.gitattributes` có `* text=auto` (BASE-REPO-003)", () => {
    expect(read(".gitattributes")).toMatch(/^\* text=auto$/m);
  });

  it("không file nào trong git bị CRLF ngoài khai báo (BASE-REPO-003)", () => {
    const out = execFileSync("git", ["ls-files", "--eol"], {
      encoding: "utf-8",
    });
    const crlf = out.split("\n").filter((l) => l.includes("w/crlf"));
    expect(crlf).toEqual([]);
  });

  it("git không theo dõi artefact build hay file env thật (BASE-REPO-002)", () => {
    const files = execFileSync("git", ["ls-files"], { encoding: "utf-8" })
      .split("\n")
      .filter(Boolean);
    const bad = files.filter(
      (f) =>
        /(^|\/)(node_modules|dist|build|\.venv)\//.test(f) ||
        (/(^|\/)\.env($|\.)/.test(f) && !/(^|\/)\.env\.example$/.test(f)),
    );
    expect(bad).toEqual([]);
  });
});
