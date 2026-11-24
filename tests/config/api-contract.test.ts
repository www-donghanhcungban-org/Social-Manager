import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Hợp đồng API (STD-API-001/008, BE-API-001/008, QA-INT-007, STD-PROC-003): `docs/openapi.yaml` đã commit phải khớp
 * route handler thật (`app/**\/route.ts`) hai chiều, và không được bỏ thao tác/mã trạng thái của major hiện tại.
 * Không có parser YAML trong node_modules (không thêm phụ thuộc): kiểm khung bằng phân tích dòng, đủ cho tệp viết tay
 * theo quy ước thụt 2 dấu cách.
 */

const SPEC_FILE = "docs/openapi.yaml";
const CONTRACT_FILE = "docs/API-CONTRACT.md";
const HTTP = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const YAML_METHODS = /^ {4}(get|put|post|delete|options|head|patch|trace):\s*$/;

/**
 * Cơ sở của từng major: thao tác và mã trạng thái đã hứa. Bỏ một mục mà không tăng major là thay đổi phá vỡ (đỏ).
 * Thêm thao tác/mã mới là tương thích, không cần sửa ở đây. Tăng major → khai cơ sở mới.
 */
const BASELINE: Record<number, Record<string, string[]>> = {
  1: {
    "GET /api/health": ["200", "503"],
    "GET /api/health/live": ["200"],
    "GET /api/metrics": ["200", "401", "404"],
    "POST /api/webhooks/socialapi/{connectionId}": [
      "200",
      "400",
      "401",
      "403",
      "413",
      "500",
    ],
    "GET /api/auth/{all}": ["200", "429"],
    "POST /api/auth/{all}": ["200", "403", "429"],
    "POST /app/account/export": ["200", "401", "403"],
  },
};

/** Mã trạng thái không nằm literal trong route.ts mà ở mô-đun handler gọi tới. */
const STATUS_SOURCES: Record<string, string[]> = {
  "/api/health": ["src/http/health.ts"],
  "/api/webhooks/socialapi/{connectionId}": ["src/inbox/webhook.ts"],
};

type Ops = Map<string, Set<string>>;

interface SpecOperation {
  path: string;
  method: string;
  operationId: string | undefined;
  hasSecurity: boolean;
  responses: string[];
}

interface ParsedSpec {
  openapi: string | undefined;
  version: string | undefined;
  topKeys: string[];
  operations: SpecOperation[];
  pathBlocks: Map<string, string[]>;
}

// ---------- handler ----------

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** `app/api/auth/[...all]/route.ts` → `/api/auth/{all}`; bỏ nhóm `(x)` và slot `@x`. */
function routeFileToPath(file: string): string {
  const segs = file.split(/[\\/]/).slice(1, -1);
  const kept = segs
    .filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith("@"))
    .map((s) => {
      const m = /^\[{1,2}(?:\.\.\.)?([^\]]+)\]{1,2}$/.exec(s);
      return m ? `{${m[1]}}` : s;
    });
  return `/${kept.join("/")}`;
}

/** Method HTTP được export từ một route.ts (function, const, hoặc `export { GET }`). */
function exportedMethods(src: string): string[] {
  const found = new Set<string>();
  for (const m of src.matchAll(
    /export\s+(?:async\s+)?(?:function|const|let)\s+([A-Z]+)\b/g,
  ))
    if (HTTP.includes(m[1]!)) found.add(m[1]!);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g))
    for (const part of m[1]!.split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()!
        .trim();
      if (HTTP.includes(name)) found.add(name);
    }
  return [...found].sort();
}

function handlerOps(files: { file: string; src: string }[]): Ops {
  const ops: Ops = new Map();
  for (const { file, src } of files) {
    const path = routeFileToPath(file);
    const set = ops.get(path) ?? new Set<string>();
    for (const m of exportedMethods(src)) set.add(m);
    ops.set(path, set);
  }
  return ops;
}

/** Mã trạng thái literal: `status: 401` và hợp kiểu `status: 200 | 503`. */
function statusLiterals(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/\bstatus:\s*((?:\d{3}\s*\|\s*)*\d{3})\b/g))
    for (const code of m[1]!.split("|")) out.add(code.trim());
  return [...out].sort();
}

// ---------- spec ----------

function topLevelSection(lines: string[], key: string): string[] {
  const start = lines.findIndex((l) => l === `${key}:`);
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^\S/.test(l));
  return end < 0 ? rest : rest.slice(0, end);
}

function parseSpec(text: string): ParsedSpec {
  const lines = text.split("\n");
  const scalar = (re: RegExp) => {
    for (const l of lines) {
      const m = re.exec(l);
      if (m) return m[1]!.replace(/^["']|["']$/g, "");
    }
    return undefined;
  };
  const topKeys = lines
    .map((l) => /^([A-Za-z][\w-]*):/.exec(l)?.[1])
    .filter((k): k is string => k !== undefined);

  const operations: SpecOperation[] = [];
  const pathBlocks = new Map<string, string[]>();
  let path: string | undefined;
  let op: SpecOperation | undefined;
  let inResponses = false;
  for (const line of topLevelSection(lines, "paths")) {
    const p = /^ {2}(\/\S*):\s*$/.exec(line);
    if (p) {
      path = p[1]!;
      op = undefined;
      pathBlocks.set(path, []);
      continue;
    }
    if (path === undefined) continue;
    pathBlocks.get(path)!.push(line);
    const m = YAML_METHODS.exec(line);
    if (m) {
      op = {
        path,
        method: m[1]!.toUpperCase(),
        operationId: undefined,
        hasSecurity: false,
        responses: [],
      };
      operations.push(op);
      inResponses = false;
      continue;
    }
    if (/^ {4}\S/.test(line)) {
      op = undefined;
      continue;
    }
    if (!op) continue;
    const id = /^ {6}operationId:\s*(\S+)\s*$/.exec(line);
    if (id) op.operationId = id[1]!;
    if (/^ {6}security:/.test(line)) op.hasSecurity = true;
    if (/^ {6}\S/.test(line)) inResponses = /^ {6}responses:\s*$/.test(line);
    const code = /^ {8}["']?(\d{3}|default)["']?:/.exec(line);
    if (inResponses && code) op.responses.push(code[1]!);
  }
  return {
    openapi: scalar(/^openapi:\s*(\S+)\s*$/),
    version: scalar(/^ {2}version:\s*(\S+)\s*$/),
    topKeys,
    operations,
    pathBlocks,
  };
}

function specOps(spec: ParsedSpec): Ops {
  const ops: Ops = new Map();
  for (const o of spec.operations) {
    const set = ops.get(o.path) ?? new Set<string>();
    set.add(o.method);
    ops.set(o.path, set);
  }
  for (const p of spec.pathBlocks.keys())
    if (!ops.has(p)) ops.set(p, new Set());
  return ops;
}

/** So hai chiều; một path không có method nào ở một phía vẫn tính là lệch. */
function diffOps(handlers: Ops, spec: Ops) {
  const flat = (ops: Ops) =>
    new Set(
      [...ops].flatMap(([p, ms]) =>
        ms.size === 0 ? [`* ${p}`] : [...ms].map((m) => `${m} ${p}`),
      ),
    );
  const h = flat(handlers);
  const s = flat(spec);
  return {
    missingInSpec: [...h].filter((x) => !s.has(x)).sort(),
    extraInSpec: [...s].filter((x) => !h.has(x)).sort(),
  };
}

/** Lỗi khung YAML tối thiểu + quy ước OpenAPI của repo. Rỗng = hợp lệ. */
function structuralErrors(text: string): string[] {
  const errors: string[] = [];
  const lines = text.split("\n");
  if (text.includes("\t")) errors.push("có ký tự tab");
  const first = lines.find((l) => l.trim() !== "" && !l.startsWith("#"));
  if (!/^openapi: 3\.1\.\d+$/.test(first ?? ""))
    errors.push("dòng đầu phải là `openapi: 3.1.x`");

  // Khoá trùng trong cùng một mapping, thụt lề lẻ, ngoặc kép lẻ; bỏ qua nội dung block scalar (`>-`, `|`).
  const frames: { indent: number; keys: Set<string> }[] = [
    { indent: 0, keys: new Set() },
  ];
  let blockOwner: number | undefined;
  lines.forEach((raw, i) => {
    const n = i + 1;
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) return;
    const indent = raw.length - raw.trimStart().length;
    if (blockOwner !== undefined) {
      if (indent > blockOwner) return;
      blockOwner = undefined;
    }
    if (indent % 2 !== 0) errors.push(`dòng ${n}: thụt lề lẻ`);
    let body = raw.trimStart();
    let keyIndent = indent;
    if (body.startsWith("- ")) {
      while (frames.length > 1 && frames.at(-1)!.indent > indent) frames.pop();
      body = body.slice(2);
      keyIndent = indent + 2;
      while (frames.length > 1 && frames.at(-1)!.indent >= keyIndent)
        frames.pop();
      frames.push({ indent: keyIndent, keys: new Set() });
    }
    const km = /^("[^"]*"|'[^']*'|[^\s"'#[{][^:#]*?):(?:\s|$)/.exec(body);
    if (km) {
      const key = km[1]!.replace(/^["']|["']$/g, "");
      while (frames.length > 1 && frames.at(-1)!.indent > keyIndent)
        frames.pop();
      if (frames.at(-1)!.indent < keyIndent)
        frames.push({ indent: keyIndent, keys: new Set() });
      const f = frames.at(-1)!;
      if (f.keys.has(key)) errors.push(`dòng ${n}: khoá trùng \`${key}\``);
      f.keys.add(key);
      const value = body.slice(km[0].length).trim();
      if (/^[>|][-+]?$/.test(value)) blockOwner = indent;
      body = value;
    } else if (!raw.trimStart().startsWith("- ")) {
      errors.push(`dòng ${n}: không phải \`khoá: giá trị\` hay mục danh sách`);
    }
    const unquoted = body.replace(/'[^']*'/g, "");
    if ((unquoted.match(/"/g) ?? []).length % 2 !== 0)
      errors.push(`dòng ${n}: ngoặc kép không đóng`);
  });

  const spec = parseSpec(text);
  for (const k of ["openapi", "info", "paths", "components"])
    if (!spec.topKeys.includes(k)) errors.push(`thiếu khoá gốc \`${k}\``);
  if (!/^\d+\.\d+\.\d+$/.test(spec.version ?? ""))
    errors.push("info.version không phải SemVer");

  // `$ref` nội bộ phải trỏ tới khoá có thật trong `components`.
  const comps = topLevelSection(lines, "components");
  const defined = new Set<string>();
  let group: string | undefined;
  for (const l of comps) {
    const g = /^ {2}(\w+):\s*$/.exec(l);
    if (g) group = g[1]!;
    const name = /^ {4}([\w.-]+):/.exec(l);
    if (group && name) defined.add(`#/components/${group}/${name[1]}`);
  }
  for (const m of text.matchAll(/\$ref:\s*["']?([^"'\s]+)["']?/g))
    if (!defined.has(m[1]!)) errors.push(`$ref không tồn tại: ${m[1]}`);

  const ids = new Set<string>();
  for (const o of spec.operations) {
    const label = `${o.method} ${o.path}`;
    if (!o.operationId) errors.push(`${label}: thiếu operationId`);
    else if (ids.has(o.operationId))
      errors.push(`${label}: operationId trùng \`${o.operationId}\``);
    else ids.add(o.operationId);
    if (!o.hasSecurity)
      errors.push(`${label}: thiếu \`security\` (công khai là \`[]\`)`);
    if (o.responses.length === 0) errors.push(`${label}: thiếu responses`);
  }
  for (const [path, block] of spec.pathBlocks) {
    const joined = block.join("\n");
    for (const p of path.matchAll(/\{([^}]+)\}/g)) {
      const declared = new RegExp(
        `name:\\s*${p[1]}\\s*\\n\\s*in:\\s*path`,
      ).test(joined);
      if (!declared) errors.push(`${path}: chưa khai tham số path \`${p[1]}\``);
    }
  }
  return errors;
}

/** Bỏ thao tác hay mã trạng thái của cơ sở major hiện tại là phá vỡ. */
function breakingChanges(
  baselines: Record<number, Record<string, string[]>>,
  spec: ParsedSpec,
): string[] {
  const major = Number((spec.version ?? "").split(".")[0]);
  const base = baselines[major];
  if (!base) return [`chưa khai cơ sở cho major ${major}`];
  const byKey = new Map(
    spec.operations.map((o) => [`${o.method} ${o.path}`, o.responses]),
  );
  const out: string[] = [];
  for (const [key, codes] of Object.entries(base)) {
    const now = byKey.get(key);
    if (!now) {
      out.push(`bỏ thao tác ${key}`);
      continue;
    }
    for (const c of codes)
      if (!now.includes(c)) out.push(`bỏ mã ${c} của ${key}`);
  }
  return out;
}

/** Hàm Server Action được export từ các tệp `'use server'` trong `app/` và `src/`. */
function serverActions(): { file: string; name: string }[] {
  return ["app", "src"]
    .flatMap((d) => walk(d))
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => ({
      file: f.split("\\").join("/"),
      src: readFileSync(f, "utf-8"),
    }))
    .filter(({ src }) =>
      /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/.test(src),
    )
    .flatMap(({ file, src }) =>
      [
        ...src.matchAll(
          /export\s+(?:async\s+function\s+(\w+)|const\s+(\w+)\s*=\s*async)/g,
        ),
      ].map((m) => ({ file, name: (m[1] ?? m[2])! })),
    );
}

// ---------- dữ liệu thật ----------

const specText = readFileSync(SPEC_FILE, "utf-8");
const spec = parseSpec(specText);
const contract = readFileSync(CONTRACT_FILE, "utf-8");
const routeFiles = walk("app")
  .filter((f) => /[\\/]route\.ts$/.test(f))
  .map((f) => ({
    file: f.split("\\").join("/"),
    src: readFileSync(f, "utf-8"),
  }));

describe("OpenAPI đã commit (STD-API-001, BE-API-001)", () => {
  it("khai openapi 3.1.x và khung YAML hợp lệ", () => {
    expect(specText).toMatch(/^openapi: 3\.(1|2)\.[0-9]+/m);
    expect(structuralErrors(specText)).toEqual([]);
  });

  it("phạm vi gồm mọi route handler đã biết", () => {
    const paths = routeFiles.map((r) => routeFileToPath(r.file)).sort();
    expect(paths).toEqual(
      expect.arrayContaining([
        "/api/auth/{all}",
        "/api/health",
        "/api/health/live",
        "/api/metrics",
        "/api/webhooks/socialapi/{connectionId}",
        "/app/account/export",
      ]),
    );
  });
});

describe("OpenAPI ↔ route handler thật (QA-INT-007, STD-API-008)", () => {
  it("mỗi method export trong route.ts có path+method trong OpenAPI và ngược lại", () => {
    expect(diffOps(handlerOps(routeFiles), specOps(spec))).toEqual({
      missingInSpec: [],
      extraInSpec: [],
    });
  });

  it("mã trạng thái literal trong handler (và mô-đun nó gọi) đều được khai", () => {
    for (const { file, src } of routeFiles) {
      const path = routeFileToPath(file);
      const sources = [
        src,
        ...(STATUS_SOURCES[path] ?? []).map((f) => readFileSync(f, "utf-8")),
      ].join("\n");
      const declared = new Set(
        spec.operations
          .filter((o) => o.path === path)
          .flatMap((o) => o.responses),
      );
      for (const code of statusLiterals(sources))
        expect(declared.has(code), `${path} trả ${code}`).toBe(true);
    }
  });

  it("không bỏ thao tác/mã trạng thái của major hiện tại (STD-PROC-003)", () => {
    expect(breakingChanges(BASELINE, spec)).toEqual([]);
  });

  it("phiên bản hợp đồng trong API-CONTRACT.md trùng info.version", () => {
    expect(spec.version).toBeDefined();
    expect(contract).toContain(`hợp đồng phiên bản ${spec.version}`);
    expect(contract).toContain(`phiên bản API v${spec.version!.split(".")[0]}`);
  });
});

describe("hàm so khớp bắt được lệch (test âm)", () => {
  const real = handlerOps(routeFiles);

  it("thiếu method trong spec → missingInSpec", () => {
    const fake: Ops = new Map([...real].map(([p, s]) => [p, new Set(s)]));
    fake.get("/api/auth/{all}")!.delete("POST");
    expect(diffOps(real, fake).missingInSpec).toEqual(["POST /api/auth/{all}"]);
  });

  it("thừa path hoặc method trong spec → extraInSpec", () => {
    const fake: Ops = new Map([...real].map(([p, s]) => [p, new Set(s)]));
    fake.set("/api/ghost", new Set(["GET"]));
    fake.get("/api/health")!.add("DELETE");
    expect(diffOps(real, fake).extraInSpec).toEqual([
      "DELETE /api/health",
      "GET /api/ghost",
    ]);
  });

  it("đổi tên tham số path → lệch hai chiều", () => {
    const handlers = handlerOps([
      {
        file: "app/api/x/[id]/route.ts",
        src: "export async function GET() {}",
      },
    ]);
    const fake: Ops = new Map([["/api/x/{xid}", new Set(["GET"])]]);
    expect(diffOps(handlers, fake)).toEqual({
      missingInSpec: ["GET /api/x/{id}"],
      extraInSpec: ["GET /api/x/{xid}"],
    });
  });

  it("path khai trong spec nhưng không có method nào → lệch", () => {
    const fake: Ops = new Map([...real, ["/api/empty", new Set<string>()]]);
    expect(diffOps(real, fake).extraInSpec).toEqual(["* /api/empty"]);
  });

  it("đọc đủ kiểu export method và bỏ export không phải method", () => {
    expect(
      exportedMethods(
        [
          "export const GET = (req: Request) => x(req);",
          "export async function POST() {}",
          "const put = 1; export { put as PUT, helper };",
          "export const dynamic = 'force-dynamic';",
          "export function GETTER() {}",
        ].join("\n"),
      ),
    ).toEqual(["GET", "POST", "PUT"]);
  });

  it("đổi đường dẫn tệp sang path OpenAPI: catch-all, optional, nhóm, slot", () => {
    expect(routeFileToPath("app/api/auth/[...all]/route.ts")).toBe(
      "/api/auth/{all}",
    );
    expect(routeFileToPath("app/(site)/docs/[[...slug]]/route.ts")).toBe(
      "/docs/{slug}",
    );
    expect(routeFileToPath("app/@modal/a/[id]/route.ts")).toBe("/a/{id}");
  });

  it("đọc mã trạng thái literal kể cả hợp kiểu", () => {
    expect(
      statusLiterals("status: 200 | 400 | 413; x({ status: 404 }); status: s"),
    ).toEqual(["200", "400", "404", "413"]);
  });

  it("bỏ thao tác hay mã trạng thái cơ sở mà không tăng major → phá vỡ", () => {
    const base = { 1: { "GET /a": ["200", "404"], "POST /b": ["201"] } };
    const head = parseSpec(
      [
        "openapi: 3.1.1",
        "info:",
        "  version: 1.4.0",
        "paths:",
        "  /a:",
        "    get:",
        "      responses:",
        '        "200":',
        "          description: ok",
      ].join("\n"),
    );
    expect(breakingChanges(base, head)).toEqual([
      "bỏ mã 404 của GET /a",
      "bỏ thao tác POST /b",
    ]);
    const bumped = { ...head, version: "2.0.0" };
    expect(breakingChanges(base, bumped)).toEqual([
      "chưa khai cơ sở cho major 2",
    ]);
  });

  it("kiểm khung YAML bắt tab, khoá trùng, $ref gãy, thiếu security/operationId, tham số path", () => {
    const bad = [
      "openapi: 3.0.3",
      "info:",
      "  title: x",
      "  title: y",
      "  version: v1",
      "paths:",
      "  /a/{id}:",
      "    get:",
      "      responses:",
      '        "200":',
      '          $ref: "#/components/responses/Nope"',
      "    post:",
      "      operationId: same",
      "      security: []",
      "      responses:",
      '        "200":',
      "\t       description: tab",
      "components:",
      "  responses:",
      "    Ok:",
      "      description: ok",
    ].join("\n");
    const errors = structuralErrors(bad).join("\n");
    expect(errors).toMatch(/có ký tự tab/);
    expect(errors).toMatch(/openapi: 3\.1\.x/);
    expect(errors).toMatch(/khoá trùng `title`/);
    expect(errors).toMatch(/info\.version không phải SemVer/);
    expect(errors).toMatch(
      /\$ref không tồn tại: #\/components\/responses\/Nope/,
    );
    expect(errors).toMatch(/GET \/a\/\{id\}: thiếu operationId/);
    expect(errors).toMatch(/GET \/a\/\{id\}: thiếu `security`/);
    expect(errors).toMatch(/chưa khai tham số path `id`/);
  });

  it("kiểm khung YAML bắt ngoặc kép không đóng và dòng không phải khoá", () => {
    const errors = structuralErrors(
      ["openapi: 3.1.1", 'info: "x', "  just text"].join("\n"),
    ).join("\n");
    expect(errors).toMatch(/ngoặc kép không đóng/);
    expect(errors).toMatch(/không phải `khoá: giá trị`/);
  });
});

describe("API-CONTRACT.md (BE-API-008, STD-API-008)", () => {
  it("có đủ mục: mô hình lỗi, idempotency, phiên bản + phá vỡ, Server Action", () => {
    for (const h of [
      "## 4. Mô hình lỗi",
      "## 5. Idempotency",
      "## 6. Phiên bản và thay đổi phá vỡ",
      "## 8. Server Action",
    ])
      expect(contract, h).toContain(h);
    expect(contract).toMatch(/BREAKING CHANGE:/);
    expect(contract).toContain(SPEC_FILE);
  });

  it("mỗi thao tác OpenAPI có một dòng trong bảng endpoint", () => {
    for (const o of spec.operations) {
      const row = new RegExp(
        `^\\|\\s*${o.method}\\s*\\|\\s*\`${o.path.replace(/[{}/]/g, "\\$&")}\`\\s*\\|`,
        "m",
      );
      expect(contract, `${o.method} ${o.path}`).toMatch(row);
    }
  });

  it("bảng Server Action khớp hai chiều với hàm 'use server' thật", () => {
    const actual = serverActions()
      .map((a) => `${a.file} ${a.name}`)
      .sort();
    expect(actual.length).toBeGreaterThan(0);
    const section = contract
      .split("## 8. Server Action")[1]!
      .split("\n## ")[0]!;
    const listed = [
      ...section.matchAll(/^\|\s*`([^`]+)`\s*\|\s*`(\w+)`\s*\|/gm),
    ]
      .map((m) => `${m[1]} ${m[2]}`)
      .sort();
    expect(listed).toEqual(actual);
  });
});
