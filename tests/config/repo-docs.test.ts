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
    expect(readme.split("\n")[0]).toBe("# X-Workspace");
  });
});

describe("tệp cộng đồng và phát hành", () => {
  it("CHANGELOG có [Unreleased] hoặc bản phát hành mới nhất ở đầu (BASE-REPO-007)", () => {
    const first = read("CHANGELOG.md")
      .split("\n")
      .find((l) => l.startsWith("## "));
    // Trước bản phát hành đầu: `## [Unreleased]`. Sau khi Release Please phát hành: `## 1.0.0 (ngày)` hoặc `## [1.0.1](url) (ngày)`.
    expect(first).toMatch(/^## (\[Unreleased\]$|\[?\d+\.\d+\.\d+)/);
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

  it("SECURITY.md chỉ nêu đường dẫn có thật và không khai RLS (AUD-DOC-001)", () => {
    const text = read("SECURITY.md");
    const paths = [...text.matchAll(/`([^`\s]+)`/g)]
      .map((m) => m[1])
      .filter(
        (p) =>
          /^[\w.-]+(\/[\w.-]+)+$/.test(p) ||
          /^[\w.-]+\.(ya?ml|json|ts|md|mjs|py|sh)$/.test(p),
      );
    expect(paths.length).toBeGreaterThan(5);
    expect(paths.filter((p) => !existsSync(p))).toEqual([]);
    expect(text).not.toMatch(/RLS bật/);
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

describe("tài liệu khớp mã (BASE-DOC-007, WF-DOC-002 phần nội bộ)", () => {
  it("BASE-DOC-007: mọi biến môi trường trong schema src/config/env.ts đều có trong bảng Cấu hình của README", () => {
    const env = read("src/config/env.ts");
    const keys = [...env.matchAll(/^ {2}([A-Z][A-Z0-9_]+): /gm)].map(
      (m) => m[1]!,
    );
    expect(keys.length).toBeGreaterThanOrEqual(10);
    const readme = read("README.md");
    expect(keys.filter((k) => !readme.includes(`\`${k}\``))).toEqual([]);
  });

  it("WF-DOC-002 (nội bộ): liên kết tương đối trong tài liệu của dự án trỏ tới tệp có thật", () => {
    const docs = [
      "README.md",
      "CONTRIBUTING.md",
      "SECURITY.md",
      "SUPPORT.md",
      "SCOPE.md",
      "PROJECT.md",
      "docs/RUNBOOK.md",
      "docs/RISKS.md",
      "docs/THREAT-MODEL.md",
    ];
    const broken: string[] = [];
    for (const f of docs) {
      for (const m of read(f).matchAll(
        /\]\((?!https?:|mailto:|#)([^)\s#]+)/g,
      )) {
        const target = new URL(m[1]!, `file:///repo/${f}`).pathname.replace(
          "/repo/",
          "",
        );
        if (!existsSync(decodeURIComponent(target)))
          broken.push(`${f} → ${m[1]}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
