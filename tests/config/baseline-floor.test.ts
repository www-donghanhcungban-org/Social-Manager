import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Hàng rào máy cho các mục sàn của blueprint (BASE-*) mà không có test hành vi riêng: quét mã đã commit.
 * Mỗi `it` ghi ID mục nó kiểm; blueprint tick kèm `— Kiểm: npx vitest run tests/config/baseline-floor.test.ts`.
 */
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf-8" })
  .split("\0")
  .filter(Boolean);
const code = tracked.filter(
  (f) =>
    /^(src|app|scripts)\/.*\.(ts|tsx|mjs|js)$/.test(f) ||
    f === "proxy.ts" ||
    f === "instrumentation.ts",
);
const read = (f: string) => readFileSync(f, "utf-8");
const hits = (files: string[], re: RegExp) =>
  files.flatMap((f) =>
    read(f)
      .split("\n")
      .flatMap((line, i) =>
        re.test(line) ? [`${f}:${i + 1}: ${line.trim()}`] : [],
      ),
  );

describe("sàn blueprint quét trên mã đã commit", () => {
  it("BASE-ERR-001: không có lỗi bị nuốt (catch rỗng, .catch(() => {}))", () => {
    expect(
      hits(
        code,
        /catch\s*(\([^)]*\))?\s*\{\s*\}|\.catch\(\s*\(\)\s*=>\s*(\{\s*\}|undefined|null)\s*\)/,
      ),
    ).toEqual([]);
  });

  it("BASE-CFG-006: không script/CLI nào nhận bí mật qua cờ dòng lệnh", () => {
    const pkg = read("package.json");
    const re = /--(password|passwd|token|secret|api-?key)\b/i;
    expect(re.test(pkg)).toBe(false);
    expect(
      hits(
        code.filter((f) => f.startsWith("scripts/")),
        re,
      ),
    ).toEqual([]);
  });

  it("BASE-CFG-007: không tắt kiểm TLS, không mở CORS, không bind/khoá mặc định không an toàn trong mã", () => {
    expect(
      hits(
        code,
        /NODE_TLS_REJECT_UNAUTHORIZED|rejectUnauthorized\s*:\s*false|Access-Control-Allow-Origin|DEBUG\s*=\s*true/,
      ),
    ).toEqual([]);
  });

  it("BASE-SEC-007: không nối chuỗi vào SQL/lệnh hệ thống (sql.raw chỉ với hằng của schema, không exec shell)", () => {
    const raw = hits(code, /sql\.raw\(/);
    expect(raw.every((h) => h.startsWith("src/db/schema.ts:"))).toBe(true);
    expect(
      hits(code, /child_process|\bexecSync\(|(^|[^.\w])exec\(|shell:\s*true/),
    ).toEqual([]);
  });

  it("BASE-DATA-005 (điều kiện Không áp dụng): schema không có cột tiền hay kiểu số thực", () => {
    const sql = tracked
      .filter(
        (f) => /^drizzle\/\d+_.*\.sql$/.test(f) && !f.endsWith(".down.sql"),
      )
      .map(read)
      .join("\n");
    expect(
      /"(price|amount|cost|money|balance|total|currency)[a-z_]*"|\b(real|double precision|numeric|money|float)\b/i.test(
        sql,
      ),
    ).toBe(false);
  });

  it("BASE-DOC-003: có ADR chọn stack; mỗi ADR đủ bối cảnh, phương án, quyết định, hệ quả", () => {
    const adrs = tracked.filter(
      (f) => /^docs\/adr\/\d{4}-.*\.md$/.test(f) && !f.includes("template"),
    );
    expect(adrs.some((f) => f.includes("stack"))).toBe(true);
    for (const f of adrs) {
      const md = read(f);
      for (const h of [/Bối cảnh/, /phương án/i, /Quyết định/, /Hệ quả/])
        expect(md, `${f} thiếu ${h}`).toMatch(
          new RegExp(`^#{2,3} .*${h.source}`, `m${h.flags}`),
        );
    }
  });

  it("BASE-GATE-005: CI không cho bước nào đỏ mà vẫn xanh (continue-on-error)", () => {
    const wf = tracked.filter((f) => f.startsWith(".github/workflows/"));
    expect(hits(wf, /continue-on-error:\s*true/)).toEqual([]);
  });
});

/**
 * Điều kiện "Không áp dụng" của các MUST đã chuyển `[~]` ở T-510 (D-020). Mỗi `it` nêu nhóm ID nó giữ: khi sản phẩm
 * thêm đúng thứ đang bị loại (WebSocket, OAuth server, MCP, cache ngoài, analytics, biểu đồ, IaC, cassette, index ngoài,
 * thanh toán, tách dịch vụ, gói thư viện) thì test đỏ → phải bỏ `[~]` và làm mục MUST tương ứng.
 */
describe("điều kiện Không áp dụng của MUST ở BLUEPRINT.md (T-510)", () => {
  const pkg = JSON.parse(read("package.json")) as {
    private?: boolean;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    [k: string]: unknown;
  };
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const depHits = (re: RegExp) => deps.filter((d) => re.test(d));

  it("BE-RT-001..004: không WebSocket/SSE trong mã hay phụ thuộc", () => {
    expect(
      depHits(/^(ws|socket\.io.*|uWebSockets.*|sockjs.*|@fastify\/websocket)$/),
    ).toEqual([]);
    expect(
      hits(
        code,
        /new WebSocket\(|EventSource|text\/event-stream|WebSocketServer/,
      ),
    ).toEqual([]);
  });

  it("STD-API-005/006: sản phẩm không là authorization server và không đăng nhập OIDC/OAuth bên thứ ba", () => {
    expect(depHits(/oidc|oauth|openid|passport|jose|jsonwebtoken/i)).toEqual(
      [],
    );
    expect(
      hits(code, /response_type|grant_type|socialProviders|genericOAuth/),
    ).toEqual([]);
  });

  it("AI-PROTO-001..004: không dùng MCP", () => {
    expect(depHits(/modelcontextprotocol|^mcp/i)).toEqual([]);
    expect(hits(code, /modelcontextprotocol|McpServer|mcpServers/i)).toEqual(
      [],
    );
  });

  it("BE-CACHE-002/005/007: không cache ứng dụng ngoài tiến trình", () => {
    expect(
      depHits(
        /redis|memcached|lru-cache|node-cache|keyv|@upstash|cache-manager/i,
      ),
    ).toEqual([]);
  });

  it("PM-METRIC-003..006, CMP-RIGHTS-003: không SDK analytics/tracking/session replay", () => {
    expect(
      depHits(
        /posthog|mixpanel|segment|amplitude|plausible|gtag|@vercel\/analytics|hotjar|fullstory|logrocket|sentry/i,
      ),
    ).toEqual([]);
    expect(
      hits(code, /posthog|gtag\(|plausible\(|mixpanel|analytics\.track|fbq\(/i),
    ).toEqual([]);
  });

  it("UX-VIZ-002: không thư viện biểu đồ, không <svg> biểu đồ trong giao diện", () => {
    expect(
      depHits(
        /chart|recharts|^d3|visx|echarts|victory|nivo|plotly|highcharts/i,
      ),
    ).toEqual([]);
  });

  it("OPS-IAC-001/003: repo không khai hạ tầng cloud bằng IaC (không tệp Terraform/Pulumi/CDK/CloudFormation)", () => {
    expect(
      tracked.filter((f) =>
        /\.(tf|tfvars|tfstate)$|^Pulumi\.|cdk\.json$|cloudformation/i.test(f),
      ),
    ).toEqual([]);
  });

  it("QA-DATA-008: không ghi/phát lại cassette HTTP", () => {
    expect(
      depHits(/nock|pollyjs|^polly|vcr|replay|talkback|msw-recorder/i),
    ).toEqual([]);
    expect(tracked.filter((f) => /cassette|\.har$/i.test(f))).toEqual([]);
  });

  it("DB-SEARCH-002: không index tìm kiếm ngoài Postgres", () => {
    expect(
      depHits(
        /elasticsearch|opensearch|meilisearch|typesense|algolia|solr|lunr|flexsearch/i,
      ),
    ).toEqual([]);
  });

  it("DB-MODEL-002, XC-UNITS-005/006, QA-UNIT-004, UX-CONTENT-006: không lưu/tính/hiển thị tiền, không thanh toán", () => {
    expect(
      depHits(
        /stripe|paypal|momo|vnpay|zalopay|braintree|adyen|decimal\.js|big\.js|dinero|currency/i,
      ),
    ).toEqual([]);
    expect(
      hits(code, /\bcurrency\b|amount_minor|\bcheckout\b|\bprice\b/i),
    ).toEqual([]);
  });

  it("ARC-STYLE-006: một khối triển khai duy nhất (không workspaces, một Dockerfile)", () => {
    expect(pkg.workspaces).toBeUndefined();
    expect(tracked.filter((f) => /(^|\/)Dockerfile[^/]*$/.test(f))).toEqual([
      "Dockerfile",
    ]);
  });

  it("QA-PERF-008: sản phẩm là ứng dụng, không phải thư viện/CLI phát hành", () => {
    expect(pkg.private).toBe(true);
    for (const k of ["bin", "main", "exports", "module"])
      expect(pkg[k], k).toBeUndefined();
  });

  it("STD-A11Y-005: PROJECT.md không khai khách hàng là cơ quan nhà nước/khu vực công EU", () => {
    expect(read("PROJECT.md")).not.toMatch(
      /khu vực công|cơ quan nhà nước|public sector/i,
    );
  });
});
