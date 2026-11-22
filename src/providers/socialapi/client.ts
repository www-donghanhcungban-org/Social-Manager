import type { ZodType } from "zod";

export const SOCIALAPI_BASE_URL = "https://api.social-api.ai/v1";

/** Lỗi từ SocialAPI hoặc từ phía client (mã bắt đầu bằng `client.`). */
export class SocialApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
    /** Giây, từ header Retry-After (429/503). */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "SocialApiError";
  }
}

export interface SocialApiClientOptions {
  apiKey: string;
  /** Tiêm được để test không gọi mạng. */
  fetch?: typeof fetch;
  baseUrl?: string;
  sleep?: (ms: number) => Promise<void>;
  /** Số lần thử lại tối đa khi 429 có Retry-After. */
  maxRetries?: number;
  /** Trần thời gian chờ mỗi lần thử lại. */
  maxWaitMs?: number;
}

export type Query = Record<string, string | number | undefined | null>;

export interface SocialApiClient {
  get<T>(path: string, schema: ZodType<T>, query?: Query): Promise<T>;
  post<T>(path: string, body: unknown, schema: ZodType<T>): Promise<T>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

function toQuery(query: Query = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

async function toApiError(res: Response): Promise<SocialApiError> {
  let code = `http.${res.status}`;
  let message = `${res.status} ${res.statusText}`.trim();
  let requestId: string | undefined;
  try {
    // Envelope: { error: { code, message, meta }, request_id } (theo repo tham chiếu).
    const env = JSON.parse(await res.text()) as {
      error?: { code?: string; message?: string };
      request_id?: string;
    };
    code = env.error?.code ?? code;
    message = env.error?.message ?? message;
    requestId = env.request_id;
  } catch {
    // body không phải JSON: giữ mã http.<status>
  }
  const retryAfter = Number(res.headers.get("Retry-After")) || undefined;
  return new SocialApiError(message, res.status, code, requestId, retryAfter);
}

export function createSocialApiClient(
  opts: SocialApiClientOptions,
): SocialApiClient {
  const doFetch = opts.fetch ?? fetch;
  const base = opts.baseUrl ?? SOCIALAPI_BASE_URL;
  const sleep = opts.sleep ?? defaultSleep;
  const maxRetries = opts.maxRetries ?? 2;
  const maxWaitMs = opts.maxWaitMs ?? 30_000;

  async function request<T>(
    method: "GET" | "POST",
    path: string,
    schema: ZodType<T>,
    body?: unknown,
    query?: Query,
  ): Promise<T> {
    const key = opts.apiKey.trim();
    if (!key)
      throw new SocialApiError("Chưa nhập API key.", 0, "client.no_api_key");

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(`${base}${path}${toQuery(query)}`, {
          method,
          headers: {
            Authorization: `Bearer ${key}`,
            Accept: "application/json",
            ...(body !== undefined && { "Content-Type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch {
        // Không đưa nội dung lỗi gốc vào thông báo: nó có thể chứa URL/header có khoá.
        throw new SocialApiError(
          "Không kết nối được tới SocialAPI.",
          0,
          "client.network",
        );
      }

      if (!res.ok) {
        const err = await toApiError(res);
        // Chỉ thử lại khi API nói rõ chờ bao lâu: không tự đoán rồi dội thêm tải.
        if (
          res.status === 429 &&
          err.retryAfter !== undefined &&
          attempt < maxRetries
        ) {
          await sleep(Math.min(err.retryAfter * 1000, maxWaitMs));
          continue;
        }
        throw err;
      }

      let data: unknown;
      try {
        data = JSON.parse(await res.text());
      } catch {
        throw new SocialApiError(
          "Phản hồi không phải JSON.",
          res.status,
          "client.invalid_response",
        );
      }
      const parsed = schema.safeParse(data);
      if (!parsed.success) {
        throw new SocialApiError(
          "Phản hồi SocialAPI sai hình dạng.",
          res.status,
          "client.invalid_response",
        );
      }
      return parsed.data;
    }
  }

  return {
    get: (path, schema, query) =>
      request("GET", path, schema, undefined, query),
    post: (path, body, schema) => request("POST", path, schema, body ?? {}),
  };
}
