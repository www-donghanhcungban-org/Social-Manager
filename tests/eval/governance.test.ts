import { existsSync, readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { detectPii } from "@/src/ai/redact";

const read = (f: string) => readFileSync(f, "utf-8");
const walk = (d: string): string[] =>
  existsSync(d)
    ? readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`],
      )
    : [];

const SELF = "tests/eval/governance.test.ts";

const qa = JSON.parse(read("docs/eval/qa-v1.json")) as {
  corpus: { id: string; content: string }[];
  questions: { id: string; question: string }[];
};
const sheet = read("docs/eval/DATASHEET.md");
const lock = read("docs/eval/qa-v1.lock");

/** Quản trị dữ liệu và đánh giá AI (AI-DATA-*, AI-EVAL-*, AI-RAG-004/006). */
describe("datasheet bộ đánh giá qa-v1 (AI-DATA-001/004, AI-EVAL-008)", () => {
  it("datasheet khớp khoá băm và ghi phiên bản, nguồn, giấy phép, mục đích", () => {
    const sha = /sha256: ([0-9a-f]{64})/.exec(lock)![1]!;
    expect(sheet).toContain(sha);
    expect(sheet).toMatch(/\| Phiên bản +\| 1 /);
    expect(sheet).toMatch(/\| Nguồn +\| \S/);
    expect(sheet).toMatch(/\| Giấy phép +\| MIT/);
    expect(sheet).toMatch(/\| Mục đích +\| \S/);
    expect(read("LICENSE")).toMatch(/^MIT License/);
  });

  it("mã tham chiếu bộ dữ liệu theo phiên bản trong tên tệp, không 'bản mới nhất'", () => {
    const refs = walk("tests").filter(
      (f) => f.endsWith(".ts") && f !== SELF && /docs\/eval\//.test(read(f)),
    );
    expect(refs.length).toBeGreaterThan(0);
    for (const f of refs) {
      const t = read(f);
      expect(t, f).not.toMatch(/qa-latest|qa\.json/);
      for (const m of t.matchAll(/docs\/eval\/([\w.-]+)/g))
        expect(m[1], f).toMatch(/^(qa-v\d+\.(json|lock)|DATASHEET\.md)$/);
    }
  });
});

describe("quét PII trong bộ dữ liệu (AI-DATA-003, AI-EVAL-008)", () => {
  // Địa chỉ cơ sở kinh doanh của cửa hàng giả, không gắn với cá nhân (datasheet §Địa chỉ trong kho giả).
  const BUSINESS_ADDRESS_DOCS = ["h5"];

  it("kho giả và câu hỏi không có email, CCCD, số điện thoại; địa chỉ chỉ ở tài liệu đã khai", () => {
    const found: string[] = [];
    for (const c of qa.corpus)
      for (const kind of detectPii(c.content))
        if (!(kind === "address" && BUSINESS_ADDRESS_DOCS.includes(c.id)))
          found.push(`${c.id}:${kind}`);
    for (const q of qa.questions)
      for (const kind of detectPii(q.question)) found.push(`${q.id}:${kind}`);
    expect(found).toEqual([]);
  });

  it("ngoại lệ địa chỉ còn đúng (không khai thừa)", () => {
    for (const id of BUSINESS_ADDRESS_DOCS) {
      const doc = qa.corpus.find((c) => c.id === id)!;
      expect(detectPii(doc.content), id).toContain("address");
    }
    expect(sheet).toContain("`h5`");
  });
});

describe("không có dữ liệu huấn luyện/few-shot/tinh chỉnh (AI-DATA-008: không áp dụng)", () => {
  it("mã không có huấn luyện, tinh chỉnh hay few-shot từ dữ liệu người dùng", () => {
    const code = [...walk("src"), ...walk("app")].filter((f) =>
      /\.(ts|tsx)$/.test(f),
    );
    const hits = code.filter((f) =>
      /fine[-_ ]?tun|few[-_ ]?shot|training[-_ ]?(data|set)|embedding|vector store/i.test(
        read(f),
      ),
    );
    expect(hits).toEqual([]);
    expect(sheet).toMatch(/không huấn luyện, tinh chỉnh hay dùng few-shot/);
  });
});

describe("đánh giá chạy ở CI, không gọi mô hình thật (AI-EVAL-001/002/004)", () => {
  it("bộ eval nằm trong `npm test` (vitest include tests/**) và CI chạy cổng đó", () => {
    expect(read("vitest.config.mts")).toMatch(/tests\/\*\*\/\*\.test\.ts/);
    expect(read("xt.yaml")).toMatch(/^test: "npm test/m);
    expect(existsSync("tests/eval/qa.test.ts")).toBe(true);
  });

  it("workflow CI không có khoá hay địa chỉ mô hình", () => {
    for (const f of walk(".github/workflows"))
      expect(read(f), f).not.toMatch(
        /AI_API_KEY|AI_BASE_URL|OPENAI|ANTHROPIC|api\.openai\.com/i,
      );
  });

  it("test eval/ai không gọi mạng thật: adapter luôn nhận fetch giả", () => {
    for (const f of [...walk("tests/eval"), ...walk("tests/ai")]) {
      const t = read(f);
      for (const m of t.matchAll(/createOpenAiCompatModel\(/g)) {
        const after = t.slice(m.index, m.index + 400);
        expect(after, `${f}: adapter thiếu fetch giả`).toMatch(/fetch/);
      }
    }
  });

  it("grader tất định: tests/eval không import mô hình/cổng AI", () => {
    for (const f of walk("tests/eval").filter(
      (x) => x.endsWith(".ts") && x !== SELF,
    ))
      expect(read(f), f).not.toMatch(/@\/src\/ai\//);
  });

  it("mọi lời gọi ai.complete trong src đặt max_tokens (AI-APP-006)", () => {
    const calls = walk("src")
      .filter((f) => f.endsWith(".ts"))
      .flatMap((f) => {
        const t = read(f);
        return [...t.matchAll(/\.complete\(\{/g)].map((m) => ({
          f,
          body: t.slice(m.index, m.index + 600),
        }));
      });
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.body, c.f).toMatch(/maxOutputTokens: \d+/);
  });

  it("adapter đặt timeout cho mỗi lời gọi và gateway có hạn mức theo ngày (AI-APP-006)", () => {
    expect(read("src/ai/openai-compat.ts")).toMatch(/AbortSignal\.timeout\(/);
    expect(read("src/ai/gateway.ts")).toMatch(/maxCallsPerDay/);
    expect(read("tests/ai/budget.test.ts")).toMatch(/AiBudgetError/);
  });
});

describe("xoá tài liệu lan sang chỉ mục (AI-RAG-006)", () => {
  it("chỉ mục tìm kiếm xoá theo tầng cùng giao dịch với bằng chứng (SLA = 0, không có cache/vector riêng)", () => {
    const schema = read("src/db/schema.ts");
    const block = /export const searchDocuments[\s\S]*?\n\);\n/.exec(
      schema,
    )![0];
    expect(block).toMatch(
      /evidenceItemId[\s\S]{0,80}references\(\(\) => evidenceItems\.id, \{ onDelete: "cascade" \}\)/,
    );
    expect(read("tests/search/service.test.ts")).toMatch(
      /xoá bằng chứng thì biến khỏi kết quả/,
    );
  });
});

describe("guardrail là cấu hình cổng, chạy ở server (AI-GUARD-005)", () => {
  it("dịch vụ hỏi đáp gọi guard vô điều kiện, không đọc cờ từ đầu vào", () => {
    const src = read("src/ai/answer.ts");
    expect(src).toMatch(/const verdict = checkInput\(question\);/);
    expect(src).not.toMatch(/skipGuard|disableGuard|guard\s*[:?]/);
    const action = read("app/app/[workspaceId]/search/actions.ts");
    expect(action).not.toMatch(/guard|skip|disable/i);
  });
});
