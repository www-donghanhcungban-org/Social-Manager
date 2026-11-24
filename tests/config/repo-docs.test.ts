import { readFileSync, existsSync, readdirSync } from "node:fs";
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
      .map((m) => m[1] ?? "")
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

describe("khai báo pháp lý và chuẩn (T-530)", () => {
  const project = read("PROJECT.md");
  const today = new Date("2026-11-24T00:00:00Z");
  const ageDaysOf = (ymd: string) =>
    (today.getTime() - new Date(`${ymd}T00:00:00Z`).getTime()) / 86_400_000;

  it("STD-PRIV-001, PM-RISK-007: luật có số hiệu, ngày hiệu lực, URL và nhắc kiểm tra sửa đổi", () => {
    expect(project).toMatch(/91\/2025\/QH15/);
    expect(project).toMatch(/356\/2025\/NĐ-CP/);
    expect(project).toMatch(/01\/01\/2026/);
    expect(project).toMatch(/https:\/\/\S+/);
    expect(project).toMatch(/kiểm tra văn bản sửa đổi/i);
    // Không khai bản gốc đã đối chiếu khi chưa làm.
    expect(project).toMatch(/chưa xác minh/);
  });

  it("STD-SEC-001: chuẩn bảo mật nhắm tới có phiên bản và mức", () => {
    expect(project).toMatch(/ASVS 5\.0\.0 L2/);
  });

  it("PM-RISK-007: có DPIA vì PM-REQ-009 = có dữ liệu cá nhân", () => {
    expect(project).toMatch(/Dữ liệu cá nhân: có/);
    const dpia = read("docs/DPIA.md");
    for (const h of [
      "## 1. Mô tả hoạt động xử lý",
      "## 3. Bên nhận và chuyển xuyên biên giới",
      "## 7. Rủi ro và giảm thiểu",
    ])
      expect(dpia).toContain(h);
  });

  // Sổ nhà cung cấp: dự án không có thư viện YAML, định dạng phẳng đủ cho regex.
  const vendors = read("docs/compliance/vendors.yaml")
    .split(/^- id: /m)
    .slice(1)
    .map((b) => {
      const f = (k: string) =>
        new RegExp(`^\\s*${k}:\\s*(.+)$`, "m").exec(b)?.[1]?.trim();
      return {
        id: b.split("\n")[0]!.trim(),
        code: f("code"),
        reviewed: f("reviewed") ?? "",
        dpa: f("dpa"),
        location: f("location"),
      };
    });

  it("CMP-AUDIT-007: mỗi nhà cung cấp đủ trường, rà trong 12 tháng", () => {
    expect(vendors.length).toBeGreaterThanOrEqual(3);
    for (const v of vendors) {
      expect(Boolean(v.code && v.dpa && v.location), v.id).toBe(true);
      expect(ageDaysOf(v.reviewed), `${v.id} reviewed`).toBeGreaterThanOrEqual(
        0,
      );
      expect(ageDaysOf(v.reviewed), `${v.id} quá 12 tháng`).toBeLessThanOrEqual(
        366,
      );
    }
  });

  it("CMP-AUDIT-007: mã gọi dịch vụ ngoài đều có dòng trong sổ (chặn nhà cung cấp mới không khai)", () => {
    const covered = vendors.map((v) => v.code);
    const dirs = (base: string) =>
      readdirSync(base, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => `${base}/${d.name}`);
    const callers = [
      ...dirs("src/providers"),
      ...dirs("src/connectors"),
      "src/ai",
    ];
    expect(callers.filter((c) => !covered.includes(c))).toEqual([]);
  });

  it("CMP-VN-004, CMP-AUDIT-007: danh mục luồng ra ngoài khớp sổ nhà cung cấp", () => {
    const transfers = read("docs/privacy/transfers.md");
    for (const v of vendors) expect(transfers, v.id).toContain(`\`${v.id}\``);
  });

  it("CMP-AUDIT-003: nhật ký hồ sơ quyền riêng tư có ngày, không quá 6 tháng", () => {
    const dates = [
      ...read("docs/privacy/CHANGELOG.md").matchAll(
        /^- (\d{4}-\d{2}-\d{2}) ·/gm,
      ),
    ].map((m) => m[1]!);
    expect(dates.length).toBeGreaterThan(0);
    expect(ageDaysOf(dates.sort().at(-1)!)).toBeLessThanOrEqual(183);
  });

  it("CMP-VN-006: runbook vi phạm có mốc 72 giờ, Mẫu 08, bước và diễn tập", () => {
    const rb = read("docs/ops/runbooks/data-breach.md");
    expect(rb).toMatch(/72 giờ/);
    expect(rb).toMatch(/Mẫu 08/);
    expect(rb).toMatch(/## Bước/);
    expect(rb).toMatch(/## Diễn tập/);
  });

  it("CMP-INTL-*: miễn có điều kiện kiểm được — chỉ phục vụ Việt Nam, có quyết định D-031, không có cấu hình vùng EU/UK", () => {
    expect(project).toMatch(/chỉ phục vụ người dùng và khách tại Việt Nam/);
    expect(read("docs/autopilot/DECISIONS.md")).toMatch(/### D-031 /);
    // `git grep` thoát 1 khi không khớp: coi là sạch.
    let hits = "";
    try {
      hits = execFileSync(
        "git",
        ["grep", "-liE", "gdpr|eu_region|uk_gdpr", "--", "src", "app"],
        { encoding: "utf-8" },
      ).trim();
    } catch {
      hits = "";
    }
    expect(hits).toBe("");
  });

  it("CMP-AUDIT-010: sổ sự cố trỏ mẫu post-mortem và có bảng diễn tập", () => {
    const ix = read("docs/ops/incidents/README.md");
    expect(ix).toMatch(/POST-MORTEM\.md/);
    expect(ix).toMatch(/## Diễn tập/);
  });
});
