import { existsSync, readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(f, "utf-8");
const walk = (d: string): string[] =>
  existsSync(d)
    ? readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`],
      )
    : [];
const SELF = "tests/ai/agent-boundary.test.ts";
const code = [...walk("src"), ...walk("app")].filter((f) =>
  /\.(ts|tsx)$/.test(f),
);

/**
 * Điều kiện của các mục blueprint về tác tử AI (AI-AGENT-*, AI-AGENTIC-006/007/008, SEC-AI-002/007, UX-AI-004,
 * CMP-AI-006) được miễn: sản phẩm KHÔNG có tác tử. Mô hình chỉ nhận chữ, trả chữ (H13); mọi hành động ghi đi qua mã
 * của dự án và do người kích hoạt. Test này đỏ ngay khi điều đó thôi đúng — lúc đó phải bỏ miễn trừ và làm các mục thật.
 */
describe("sản phẩm không có tác tử AI (điều kiện miễn trừ)", () => {
  it("cổng mô hình không có công cụ, chỉ thị hàm hay lựa chọn công cụ", () => {
    const port = read("src/ai/port.ts");
    const req = /export interface ModelRequest \{[\s\S]*?\n\}/.exec(port)![0];
    expect(req).not.toMatch(/tools?\b|tool_choice|functions?\b/i);
    expect(req).toMatch(/system: string;[\s\S]*user: string;/);
    const resp = /export interface ModelResponse \{[\s\S]*?\n\}/.exec(port)![0];
    expect(resp).not.toMatch(/tool_calls?|toolCalls?|function_call/i);
  });

  it("adapter không gửi và không đọc công cụ", () => {
    const a = read("src/ai/openai-compat.ts");
    expect(a).not.toMatch(/tool_calls?|tool_choice|\btools\s*:|function_call/);
  });

  it("chỉ có một nơi gọi mô hình (hỏi đáp) và nó không nhận hay chạy hành động", () => {
    const callers = code.filter((f) => /\.complete\(\{/.test(read(f)));
    expect(callers).toEqual(["src/ai/answer.ts"]);
    const answer = read("src/ai/answer.ts");
    expect(answer).not.toMatch(
      /actions\/|createActionService|requestSend|dispatch\(/,
    );
    expect(answer).not.toMatch(/\.(insert|update|delete)\(/);
  });

  it("không có thư viện hay vòng lặp tác tử, không có agent con", () => {
    const pkg = read("package.json");
    expect(pkg).not.toMatch(
      /"(@anthropic-ai\/(claude-agent-sdk|sdk)|openai|langchain|@langchain\/[\w-]+|ai|@ai-sdk\/[\w-]+|autogen|crewai|llamaindex|@modelcontextprotocol\/sdk)"/,
    );
    const hits = code.filter((f) =>
      /bypassPermissions|dangerously-skip-permissions|autoApprove|sub-?agent|max_?agent_?depth|toolRegistry|allowed_?tools/i.test(
        read(f),
      ),
    );
    expect(hits).toEqual([]);
  });

  it("mô-đun AI không phụ thuộc sổ hành động, nháp, nhà cung cấp mạng xã hội hay job", () => {
    for (const f of walk("src/ai").filter((x) => x.endsWith(".ts")))
      expect(read(f), f).not.toMatch(
        /from "\.\.\/(actions|jobs|posts)\/|from "\.\.\/providers\/(?!types")/,
      );
  });

  it("không quyết định tự động về quyền lợi: không có điểm số, xếp hạng hay từ chối dịch vụ do AI", () => {
    const hits = code.filter(
      (f) =>
        f.startsWith("src/ai/") &&
        /\b(score|ranking|creditScore|riskScore|denyService)\b/i.test(read(f)),
    );
    expect(hits).toEqual([]);
    // Kết quả AI chỉ là văn bản + trích dẫn để người đọc; không có cột/trạng thái quyết định gắn với nó.
    expect(read("src/ai/answer.ts")).toMatch(/generatedBy: "ai"/);
  });
});

/** Tác dụng phụ đối ngoại luôn do người yêu cầu và đi qua sổ hành động (SEC-AI-005, AI-AGENTIC-003). */
describe("tác dụng phụ đối ngoại: người yêu cầu, sổ hành động, gửi một lần", () => {
  it("dịch vụ sổ hành động đòi người dùng có quyền và không có đường gửi trực tiếp từ giao diện", () => {
    const ledger = read("src/actions/ledger.ts");
    expect(ledger).toMatch(/requestSend/);
    // Gửi thật chỉ xảy ra trong `dispatch` đã nhận việc bằng cập nhật có điều kiện trên hàng `queued`.
    expect(ledger).toMatch(/eq\(actionLedger\.state, "queued"\)/);
    const pages = walk("app").filter((f) => /\.(ts|tsx)$/.test(f));
    for (const f of pages) expect(read(f), f).not.toMatch(/\.sendMessage\(/);
  });

  it("test của sổ hành động phủ gửi một lần, người ngoài bị từ chối, cờ hệ thống mặc định tắt", () => {
    const t = read("tests/actions/ledger.test.ts");
    expect(t).toMatch(/hai dispatch song song: chỉ một thắng/);
    expect(t).toMatch(/người ngoài Forbidden|người ngoài/);
    expect(read("src/config/env.ts")).toMatch(/OUTBOUND_LIVE/);
  });

  it("file này không tự khớp các mẫu cấm", () => {
    expect(existsSync(SELF)).toBe(true);
  });
});
