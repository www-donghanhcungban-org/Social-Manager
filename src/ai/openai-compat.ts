import { z } from "zod";

import { ModelError, type ModelPort } from "./port";

const TIMEOUT_MS = 60_000;

const Completion = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable() }) }))
    .min(1),
  model: z.string().max(200).optional(),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});

/**
 * Điểm cuối cục bộ = dữ liệu không rời máy/mạng của người dùng: `localhost`, địa chỉ loopback, địa chỉ mạng riêng
 * (10/8, 172.16/12, 192.168/16, fc00::/7, link-local) hoặc tên một nhãn không có dấu chấm (tên dịch vụ trong mạng
 * compose, vd `ollama`). Tên miền đầy đủ (có dấu chấm) luôn coi là đám mây.
 */
export function isLocalEndpoint(baseUrl: string): boolean {
  const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  // Có dấu hai chấm là địa chỉ IPv6: loopback, ULA (fc00::/7) hoặc link-local (fe80::/10).
  if (host.includes(":"))
    return host === "::1" || /^f[cd]/.test(host) || host.startsWith("fe80:");
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  // Tên một nhãn (không có dấu chấm): tên dịch vụ trong mạng compose.
  return !host.includes(".");
}

/**
 * Adapter cho điểm cuối tương thích OpenAI `POST {base}/chat/completions` (Ollama, vLLM, dịch vụ tương thích). Dùng `fetch`
 * — chưa thêm phụ thuộc AI SDK (D-014). Khoá API chỉ nằm trong header; lỗi mang mã ngắn, không mang thân phản hồi.
 */
export function createOpenAiCompatModel(opts: {
  baseUrl: string;
  model: string;
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): ModelPort {
  const base = new URL(opts.baseUrl);
  const url = new URL(
    `${base.pathname.replace(/\/+$/, "")}/chat/completions`,
    base,
  );
  const doFetch = opts.fetch ?? fetch;
  return {
    id: "openai-compat",
    model: opts.model,
    local: isLocalEndpoint(opts.baseUrl),
    host: base.host,
    async generate(req) {
      const signal = AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS);
      let res: Response;
      try {
        res = await doFetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: opts.model,
            temperature: 0,
            ...(req.maxOutputTokens ? { max_tokens: req.maxOutputTokens } : {}),
            messages: [
              { role: "system", content: req.system },
              { role: "user", content: req.user },
            ],
          }),
          signal,
        });
      } catch {
        // Không đưa lỗi gốc vào thông báo: nó có thể chứa URL hay header có khoá.
        throw new ModelError(
          signal.aborted ? "model.timeout" : "model.network",
          signal.aborted
            ? "Mô hình không phản hồi kịp"
            : "Không kết nối được mô hình",
        );
      }
      if (!res.ok)
        throw new ModelError(
          `model.http.${res.status}`,
          `Mô hình trả ${res.status}`,
        );
      let json: unknown;
      try {
        json = JSON.parse(await res.text());
      } catch {
        throw new ModelError(
          "model.invalid_response",
          "Phản hồi mô hình không phải JSON",
        );
      }
      const parsed = Completion.safeParse(json);
      const text = parsed.success
        ? parsed.data.choices[0]!.message.content
        : null;
      if (text === null || text === undefined)
        throw new ModelError(
          "model.invalid_response",
          "Phản hồi mô hình sai hình dạng",
        );
      const u = parsed.success ? parsed.data.usage : undefined;
      return {
        text,
        ...(u && {
          usage: {
            inputTokens: u.prompt_tokens,
            outputTokens: u.completion_tokens,
          },
        }),
        ...(parsed.success &&
          parsed.data.model && { responseModel: parsed.data.model }),
      };
    },
  };
}
