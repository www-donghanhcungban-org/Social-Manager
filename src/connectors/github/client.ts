import type { ZodType } from "zod";

/**
 * Client GitHub REST tối thiểu, chỉ đọc. Nguồn: https://docs.github.com/en/rest (đọc 2026-11-22, xem
 * docs/research/2026-11-22-x-workspace-research.md §4). Phiên bản API ghim `2022-11-28` (còn hỗ trợ tới 2028-03-10).
 *
 * Bảo vệ: token chỉ nằm trong header; mọi lỗi mang mã ngắn, không mang thân phản hồi hay token; chỉ theo liên kết phân
 * trang cùng nguồn (origin) với `baseUrl` — một `Link` trỏ sang nơi khác không bao giờ nhận được token.
 */
export const GITHUB_API_BASE = "https://api.github.com";
const API_VERSION = "2022-11-28";
const TIMEOUT_MS = 20_000;

export type GithubErrorCode =
  | "rate_limited"
  | "unauthorized"
  | "not_found"
  | "client.timeout"
  | "client.network"
  | "client.invalid_response"
  | "client.bad_link"
  | `http.${number}`;

export class GithubError extends Error {
  readonly name = "GithubError";
  constructor(
    readonly code: GithubErrorCode,
    message: string,
    /** Với `rate_limited`: thời điểm được gọi lại (epoch ms), nếu biết. */
    readonly resetAtMs?: number,
  ) {
    super(message);
  }
}

export interface GithubClientOptions {
  token: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  now?: () => number;
}

export interface Page<T> {
  items: T[];
  /** URL trang kế (đã kiểm cùng origin); null = trang cuối. */
  next: string | null;
}

const NEXT_LINK = /<([^>]+)>\s*;\s*rel="next"/;

export function createGithubClient(opts: GithubClientOptions) {
  const doFetch = opts.fetch ?? fetch;
  const base = new URL(opts.baseUrl ?? GITHUB_API_BASE);
  const now = opts.now ?? (() => Date.now());
  const token = opts.token.trim();

  function rateLimit(res: Response): GithubError {
    const retryAfter = Number(res.headers.get("retry-after"));
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    const at =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? now() + retryAfter * 1000
        : Number.isFinite(reset) && reset > 0
          ? reset * 1000
          : undefined;
    return new GithubError("rate_limited", "Hết hạn mức gọi GitHub", at);
  }

  /** GET một URL tuyệt đối đã kiểm cùng origin; trả JSON đã validate và liên kết trang kế. */
  async function getPage<T>(
    url: URL,
    schema: ZodType<T>,
  ): Promise<{ data: T; next: string | null }> {
    if (!token) throw new GithubError("unauthorized", "Chưa có token GitHub");
    if (url.origin !== base.origin)
      throw new GithubError("client.bad_link", "Liên kết ngoài nguồn GitHub");
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    let res: Response;
    try {
      res = await doFetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": API_VERSION,
          "User-Agent": "x-workspace",
        },
        signal,
      });
    } catch {
      // Không đưa lỗi gốc vào thông báo: nó có thể chứa URL hay header.
      throw new GithubError(
        signal.aborted ? "client.timeout" : "client.network",
        signal.aborted
          ? "GitHub không phản hồi kịp"
          : "Không kết nối được GitHub",
      );
    }
    if (!res.ok) {
      if (res.status === 401)
        throw new GithubError("unauthorized", "Token GitHub không hợp lệ");
      if (res.status === 429) throw rateLimit(res);
      if (res.status === 403) {
        // 403 là hết hạn mức khi còn 0 lượt hoặc có retry-after (giới hạn phụ); còn lại là thiếu quyền.
        if (
          res.headers.get("x-ratelimit-remaining") === "0" ||
          res.headers.get("retry-after") !== null
        )
          throw rateLimit(res);
        throw new GithubError("http.403", "GitHub từ chối (thiếu quyền?)");
      }
      if (res.status === 404)
        throw new GithubError(
          "not_found",
          "Không thấy repo hoặc không có quyền",
        );
      throw new GithubError(`http.${res.status}`, `GitHub trả ${res.status}`);
    }
    let json: unknown;
    try {
      json = JSON.parse(await res.text());
    } catch {
      throw new GithubError(
        "client.invalid_response",
        "Phản hồi không phải JSON",
      );
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success)
      throw new GithubError(
        "client.invalid_response",
        "Phản hồi GitHub sai hình dạng",
      );
    const link = NEXT_LINK.exec(res.headers.get("link") ?? "");
    return { data: parsed.data, next: link ? link[1]! : null };
  }

  return {
    /** Trang đầu của một đường dẫn kèm tham số, hoặc trang kế từ `next` của lần trước. */
    async list<T>(
      pathOrNext: string,
      query: Record<string, string | number | undefined>,
      schema: ZodType<T[]>,
    ): Promise<Page<T>> {
      const url = pathOrNext.startsWith("https://")
        ? new URL(pathOrNext)
        : new URL(pathOrNext, base);
      if (!pathOrNext.startsWith("https://"))
        for (const [k, v] of Object.entries(query))
          if (v !== undefined) url.searchParams.set(k, String(v));
      const { data, next } = await getPage(url, schema);
      if (next !== null) {
        // Chỉ nhận trang kế cùng origin; kiểm sớm để lỗi báo đúng chỗ.
        if (new URL(next).origin !== base.origin)
          throw new GithubError(
            "client.bad_link",
            "Liên kết ngoài nguồn GitHub",
          );
      }
      return { items: data, next };
    },
  };
}

export type GithubClient = ReturnType<typeof createGithubClient>;
