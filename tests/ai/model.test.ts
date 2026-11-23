import { describe, expect, it } from "vitest";

import {
  createOpenAiCompatModel,
  isLocalEndpoint,
} from "@/src/ai/openai-compat";
import { ModelError } from "@/src/ai/port";

const KEY = "sk-live-SECRET-KEY-123";

function fake(
  handler: (url: URL, init: RequestInit) => Response | Promise<Response>,
) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  }) as typeof fetch;
  return { fn, calls };
}
const ok = (content: string | null) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
  });

describe("điểm cuối cục bộ hay đám mây", () => {
  it.each([
    ["http://localhost:11434/v1", true],
    ["http://127.0.0.1:8000/v1", true],
    ["http://127.5.5.5/v1", true],
    ["http://[::1]:8080/v1", true],
    ["http://10.1.2.3/v1", true],
    ["http://172.16.0.1/v1", true],
    ["http://172.31.255.1/v1", true],
    ["http://192.168.1.50:11434/v1", true],
    ["http://169.254.1.1/v1", true],
    ["http://[fd12::1]/v1", true],
    ["http://[fe80::1]/v1", true],
    ["http://ollama:11434/v1", true],
    ["http://fdlocal:11434/v1", true],
    ["http://app.localhost/v1", true],
    ["https://api.openai.com/v1", false],
    ["https://llm.example.com/v1", false],
    ["http://172.32.0.1/v1", false],
    ["http://172.15.0.1/v1", false],
    ["http://8.8.8.8/v1", false],
    ["http://192.169.1.1/v1", false],
    ["http://localhost.evil.com/v1", false],
    ["http://127.0.0.1.evil.com/v1", false],
    ["http://[2001:db8::1]/v1", false],
  ])("%s → cục bộ = %s", (url, local) => {
    expect(isLocalEndpoint(url)).toBe(local);
  });
});

describe("adapter OpenAI-tương-thích", () => {
  it("gửi system + user tới /chat/completions, nhiệt độ 0, khoá trong header; trả chữ", async () => {
    const f = fake(() => ok("xin chào"));
    const m = createOpenAiCompatModel({
      baseUrl: "https://llm.example.com/v1/",
      model: "m1",
      apiKey: KEY,
      fetch: f.fn,
    });
    expect(m).toMatchObject({
      model: "m1",
      local: false,
      host: "llm.example.com",
    });
    expect(
      await m.generate({ system: "S", user: "U", maxOutputTokens: 100 }),
    ).toEqual({
      text: "xin chào",
    });
    expect(f.calls[0]!.url.href).toBe(
      "https://llm.example.com/v1/chat/completions",
    );
    expect(
      (f.calls[0]!.init.headers as Record<string, string>).Authorization,
    ).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({
      model: "m1",
      temperature: 0,
      max_tokens: 100,
      messages: [
        { role: "system", content: "S" },
        { role: "user", content: "U" },
      ],
    });
  });

  it("điểm cuối cục bộ không cần khoá: không gửi Authorization", async () => {
    const f = fake(() => ok("x"));
    const m = createOpenAiCompatModel({
      baseUrl: "http://localhost:11434/v1",
      model: "m",
      fetch: f.fn,
    });
    expect(m.local).toBe(true);
    await m.generate({ system: "s", user: "u" });
    expect(
      (f.calls[0]!.init.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
  });

  it.each([
    [401, "model.http.401"],
    [429, "model.http.429"],
    [500, "model.http.500"],
  ])(
    "HTTP %i → mã %s, thông báo không lộ thân phản hồi hay khoá",
    async (status, code) => {
      const f = fake(() => new Response(`lộ ${KEY}`, { status }));
      const m = createOpenAiCompatModel({
        baseUrl: "https://x.example.com/v1",
        model: "m",
        apiKey: KEY,
        fetch: f.fn,
      });
      const err = (await m
        .generate({ system: "s", user: "u" })
        .catch((e: unknown) => e)) as ModelError;
      expect(err).toBeInstanceOf(ModelError);
      expect(err.code).toBe(code);
      expect(err.message).not.toContain(KEY);
    },
  );

  it("lỗi mạng và hết giờ: mã riêng, không lộ URL/khoá", async () => {
    const net = createOpenAiCompatModel({
      baseUrl: "https://x.example.com/v1",
      model: "m",
      apiKey: KEY,
      fetch: (async () => {
        throw new Error(`ECONNRESET https://x.example.com ${KEY}`);
      }) as unknown as typeof fetch,
    });
    const e1 = (await net
      .generate({ system: "s", user: "u" })
      .catch((e: unknown) => e)) as ModelError;
    expect(e1.code).toBe("model.network");
    expect(e1.message).not.toMatch(/ECONNRESET|sk-live|example\.com/);

    const slow = createOpenAiCompatModel({
      baseUrl: "https://x.example.com/v1",
      model: "m",
      timeoutMs: 20,
      fetch: ((_u: unknown, init?: RequestInit) =>
        new Promise((_res, rej) => {
          init?.signal?.addEventListener("abort", () =>
            rej(new Error("abort")),
          );
        })) as unknown as typeof fetch,
    });
    expect(
      (
        (await slow
          .generate({ system: "s", user: "u" })
          .catch((e: unknown) => e)) as ModelError
      ).code,
    ).toBe("model.timeout");
  });

  it("phản hồi không phải JSON, sai hình dạng hoặc nội dung null là invalid_response", async () => {
    for (const body of [
      "<html>",
      JSON.stringify({ choices: [] }),
      JSON.stringify({}),
      JSON.stringify({ choices: [{ message: { content: null } }] }),
    ]) {
      const m = createOpenAiCompatModel({
        baseUrl: "https://x.example.com/v1",
        model: "m",
        fetch: fake(() => new Response(body, { status: 200 })).fn,
      });
      expect(
        (
          (await m
            .generate({ system: "s", user: "u" })
            .catch((e: unknown) => e)) as ModelError
        ).code,
      ).toBe("model.invalid_response");
    }
  });
});
