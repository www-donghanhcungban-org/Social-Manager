import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { cacheControlFor, buildCsp } from "@/src/security/headers";

/**
 * MUST nhóm bảo mật web (T-521): mỗi `it` nêu ID nó giữ. Blueprint tick kèm
 * `— Kiểm: npx vitest run tests/security tests/http tests/evidence`.
 */
const read = (f: string) => readFileSync(f, "utf-8");
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const code = (dir: string) => walk(dir).filter((f) => /\.(ts|tsx)$/.test(f));
const appSrc = [...code("app"), ...code("src"), "proxy.ts"];

describe("injection và DOM sink (SEC-WEB-001, SEC-WEB-004, FE-SEC-001)", () => {
  it("SEC-WEB-001: không SQL thô, không chạy lệnh hệ thống, không nối chuỗi vào câu SQL", () => {
    const bad: string[] = [];
    for (const f of appSrc) {
      const t = read(f);
      // `sql.raw` chỉ được ở schema.ts, với HẰNG SỐ của mã (danh sách enum, trần số) — không bao giờ đầu vào người dùng.
      if (/\bsql\.raw\(/.test(t) && f !== "src/db/schema.ts")
        bad.push(`${f}: sql.raw`);
      if (/child_process|(?<![.\w])(execSync|spawnSync|spawn|exec)\(/.test(t))
        bad.push(`${f}: lệnh hệ thống`);
      // pg client/pool gọi `.query(` bằng template có `${` là nối chuỗi.
      if (/\.query\(\s*`[^`]*\$\{/.test(t)) bad.push(`${f}: query nối chuỗi`);
      if (/\.execute\(\s*["'`][^"'`]*["'`]\s*\+/.test(t))
        bad.push(`${f}: execute nối chuỗi`);
    }
    expect(bad).toEqual([]);
  });

  it("SEC-WEB-004, FE-SEC-001: không có điểm tắt escape/DOM sink nào trong app/ và src/; lint react/no-danger ở mức error", () => {
    const sink =
      /dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write\(|bypassSecurityTrust|v-html|\{@html/;
    expect(appSrc.filter((f) => sink.test(read(f)))).toEqual([]);
    expect(read("eslint.config.mjs")).toMatch(/"react\/no-danger":\s*"error"/);
  });
});

describe("URL ngoài và CSP (FE-SEC-002, FE-SEC-003)", () => {
  it("FE-SEC-002: href/src trong giao diện chỉ là đường dẫn nội bộ; URL ngoài phải qua safeUrl()", () => {
    const attr = /\b(?:href|src)=(\{[^}]*\}|"[^"]*")/g;
    const bad: string[] = [];
    let n = 0;
    for (const f of code("app").filter((f) => f.endsWith(".tsx")))
      for (const m of read(f).matchAll(attr)) {
        n++;
        const v = m[1]!.replace(/^\{|\}$/g, "").trim();
        const internal =
          /^[`"']\/(?!\/)/.test(v) || // "/app/..." hoặc `/app/${…}`
          /^[`"']\$\{(base|href)\b/.test(v) || // `${base}/inbox`
          v === "base" || // base = `/app/${workspaceId}`
          /^(href|base)\(/.test(v) || // href({ … }) dựng đường dẫn nội bộ
          /safeUrl\(/.test(v);
        if (!internal) bad.push(`${f}: ${m[0]}`);
      }
    expect(n).toBeGreaterThan(10);
    expect(bad).toEqual([]);
    expect(existsSync("src/security/safe-url.ts")).toBe(true);
    expect(existsSync("tests/security/safe-url.test.ts")).toBe(true);
  });

  it("FE-SEC-003: CSP production: script nonce + strict-dynamic, không unsafe-inline/eval, object-src và base-uri none, frame-ancestors none", () => {
    const csp = buildCsp({ nonce: "abc123==", dev: false });
    const script = csp.split("; ").find((d) => d.startsWith("script-src "))!;
    expect(script).toContain("'nonce-abc123=='");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    // Nonce theo từng phản hồi: proxy sinh mới mỗi request; không có thẻ <script> tĩnh trong mã giao diện.
    expect(read("proxy.ts")).toMatch(/newNonce\(\)/);
    expect(code("app").filter((f) => /<script[\s>]/.test(read(f)))).toEqual([]);
  });
});

describe("phiên và lưu trữ phía trình duyệt (FE-SEC-005, FE-STATE-008)", () => {
  it("không dùng localStorage/sessionStorage/IndexedDB/document.cookie/persist; danh sách duyệt rỗng", () => {
    const re =
      /localStorage|sessionStorage|indexedDB|document\.cookie|\bpersist\(/;
    expect(
      [...code("app"), ...code("src")].filter((f) => re.test(read(f))),
    ).toEqual([]);
    const doc = read("docs/CLIENT-STORAGE.md");
    expect(doc).toMatch(/Danh sách đã duyệt: rỗng/);
  });

  it("cookie phiên: Secure, Path=/, tiền tố __Host-, không tắt HttpOnly, không lộ cho JS", () => {
    const a = read("src/auth/auth.ts");
    expect(a).toMatch(/secure:\s*true/);
    expect(a).toMatch(/cookiePrefix:\s*"__Host-/);
    expect(a).not.toMatch(/httpOnly:\s*false/);
  });
});

describe("xác thực, phân quyền và CSRF ở server (FE-FORM-010, PRF-WEB-004, FE-RENDER-005, BE-API-009)", () => {
  it("FE-FORM-010: proxy áp lớp chống CSRF (Sec-Fetch-Site/Origin) cho mọi request đổi trạng thái; có test đơn vị và E2E 403", () => {
    const p = read("proxy.ts");
    expect(p).toMatch(/isCrossSiteMutation\(request\.method/);
    expect(p).toMatch(/status:\s*403/);
    expect(read("e2e/security-headers.spec.ts")).toMatch(
      /POST cross-site bị từ chối 403/,
    );
    expect(read("tests/security/csrf.test.ts")).toMatch(
      /Origin khớp host nhưng khác cổng/,
    );
  });

  it("PRF-WEB-004: mọi Server Action xuất ra gọi requireUser/requireWorkspace trước khi làm gì khác", () => {
    const files = code("app").filter((f) => f.endsWith("actions.ts"));
    expect(files.length).toBeGreaterThanOrEqual(8);
    const bad: string[] = [];
    let n = 0;
    for (const f of files) {
      const parts = read(f)
        .split(/^export async function /m)
        .slice(1);
      for (const part of parts) {
        n++;
        const name = /^(\w+)/.exec(part)?.[1];
        const body = part.slice(part.indexOf("{"));
        // Hành động đăng nhập/đăng ký đi qua Better Auth (xác thực chính nó); còn lại phải kiểm phiên.
        const direct = /\b(requireWorkspace|requireUser|requireSession)\(/.test(
          body,
        );
        // Qua helper `run(...)` của chính tệp, và helper đó phải kiểm phiên.
        const viaRun =
          /^\s*return run\(/m.test(body) &&
          /async function run[\s\S]*?requireWorkspace\(/.test(read(f));
        if (!direct && !viaRun) bad.push(`${f}: ${name}`);
      }
    }
    expect(n).toBeGreaterThan(15);
    expect(bad).toEqual([]);
  });

  it("FE-RENDER-005: layout và trang bảo vệ kiểm phiên ở server (requireUser) và chuyển về /login; E2E curl không cookie → /login", () => {
    expect(read("app/app/layout.tsx")).toMatch(/await requireUser\(\)/);
    expect(read("src/server/runtime.ts")).toMatch(/redirect\("\/login"\)/);
    expect(read("e2e/smoke.spec.ts")).toMatch(
      /\/app và workspace bị chuyển về \/login/,
    );
  });

  it("BE-API-009: route công khai trong app/api khớp danh sách đã duyệt ở docs/ARCHITECTURE.md", () => {
    const routes = walk("app/api")
      .filter((f) => /\/route\.ts$/.test(f))
      .map((f) => "/" + f.replace(/\/route\.ts$/, "").replace(/^app\//, ""))
      .map((r) => r.replace("[...all]", "*"))
      .sort();
    const doc = read("docs/ARCHITECTURE.md");
    const section = doc.slice(
      doc.indexOf("## Điểm cuối công khai"),
      doc.indexOf("## Quy tắc ranh giới"),
    );
    const listed = [...section.matchAll(/^\| `([^`]+)`\s+\|/gm)]
      .map((m) => m[1]!)
      .sort();
    expect(routes).toEqual(listed);
    // Mỗi route có cơ chế xác thực riêng, không để ngỏ.
    expect(read("app/api/webhooks/socialapi/[connectionId]/route.ts")).toMatch(
      /SIGNATURE_HEADER/,
    );
  });
});

describe("tệp và nội dung lưu (BE-FILE-001/003/004/005)", () => {
  it("BE-FILE-001, BE-FILE-005: không có đường tải lên/tải xuống tệp của người dùng (nội dung chỉ là chữ qua biểu mẫu)", () => {
    const bad: string[] = [];
    for (const f of appSrc) {
      const t = read(f);
      if (
        /type=["']file["']|multipart\/form-data|formData\.get\([^)]*\)\s+as\s+File|instanceof File/.test(
          t,
        )
      )
        bad.push(`${f}: tải lên`);
      if (
        /Content-Disposition|new Response\([^)]*(Uint8Array|Buffer|blob)/i.test(
          t,
        )
      )
        bad.push(`${f}: tải xuống`);
    }
    expect(bad).toEqual([]);
  });

  it("BE-FILE-003: khoá lưu do server sinh (sha256 hex), chặn .. và / (tests/evidence)", () => {
    const b = read("src/evidence/blob-store.ts");
    expect(b).toMatch(/\^\[0-9a-f\]\{64\}\$/);
    expect(b).toMatch(/join\(dir, sha256\.slice\(0, 2\), sha256\)/);
    expect(read("tests/evidence/service.test.ts")).toMatch(
      /từ chối khoá không phải sha256 \(chặn thoát thư mục\)/,
    );
  });

  it("BE-FILE-004: kho blob ngoài webroot (BLOB_DIR=/data/blobs, volume), không route nào phục vụ trực tiếp", () => {
    expect(read("docker-compose.yml")).toMatch(/BLOB_DIR:\s*\/data\/blobs/);
    expect(existsSync("public/blobs")).toBe(false);
    expect(
      appSrc.filter(
        (f) =>
          /createFsBlobStore|blobStore\.get|BLOB_DIR/.test(read(f)) &&
          f.startsWith("app/"),
      ),
    ).toEqual([]);
  });
});

describe("cache theo người dùng (BE-CACHE-001, FE-RENDER-002)", () => {
  it("route theo người dùng luôn private/no-store; không s-maxage, ISR hay force-static", () => {
    for (const path of [
      "/app",
      "/app/abc/inbox",
      "/login",
      "/api/auth/get-session",
    ])
      expect(cacheControlFor(path), path).toMatch(/private|no-store/);
    const bad = [...code("app"), ...code("src"), "proxy.ts"].filter((f) =>
      /s-maxage|force-static|export const revalidate|unstable_cache|revalidate:\s*\d/.test(
        read(f),
      ),
    );
    expect(bad).toEqual([]);
    expect(read("proxy.ts")).toMatch(/Cache-Control/);
  });
});

describe("kiểm đầu vào (BE-API-003)", () => {
  it("đầu vào webhook, biểu mẫu và dịch vụ được kiểm bằng schema/ValidationError; sai → 400, không 500", () => {
    // Kiểm bằng hàm kiểm tay có kiểu (ValidationError) chứ không phải thư viện schema; hành vi (400 có cấu trúc) mới là thứ test giữ.
    expect(read("src/providers/socialapi/webhook.ts")).toMatch(
      /new ValidationError\(`Webhook không hợp lệ/,
    );
    expect(read("tests/inbox/webhook.test.ts")).toMatch(
      /chữ ký đúng nhưng thân hỏng → 400/,
    );
    expect(read("tests/inbox/webhook.test.ts")).toMatch(/thân quá lớn → 413/);
    expect(read("tests/evidence/service.test.ts")).toMatch(
      /từ chối nội dung rỗng, quá trần/,
    );
    expect(read("src/http/errors.ts")).toMatch(/ValidationError/);
  });
});
