import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  createSocialApiClient,
  SocialApiError,
} from "@/src/providers/socialapi/client";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

const Ok = z.object({ ok: z.boolean() });

describe("createSocialApiClient", () => {
  it("gửi Bearer key, Accept JSON và body JSON tới đúng URL", async () => {
    const fetchMock = vi.fn(async () => json({ ok: true }));
    const c = createSocialApiClient({ apiKey: "k-123", fetch: fetchMock });
    await c.post("/posts", { text: "x" }, Ok);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.social-api.ai/v1/posts");
    expect(init.method).toBe("POST");
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer k-123");
    expect(h["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ text: "x" }));
  });

  it("key rỗng hoặc chỉ khoảng trắng bị từ chối trước khi gọi mạng", async () => {
    const fetchMock = vi.fn();
    for (const apiKey of ["", "   "]) {
      const c = createSocialApiClient({ apiKey, fetch: fetchMock });
      await expect(c.get("/me", Ok)).rejects.toMatchObject({
        code: "client.no_api_key",
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("đọc envelope lỗi { error: { code, message }, request_id }", async () => {
    const c = createSocialApiClient({
      apiKey: "k",
      fetch: async () =>
        json(
          {
            error: { code: "auth.invalid_key", message: "Key sai" },
            request_id: "req_1",
          },
          { status: 401 },
        ),
    });
    const err = await c.get("/me", Ok).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SocialApiError);
    expect(err).toMatchObject({
      status: 401,
      code: "auth.invalid_key",
      message: "Key sai",
      requestId: "req_1",
    });
  });

  it("lỗi có body không phải JSON vẫn thành SocialApiError với mã http.<status>", async () => {
    const c = createSocialApiClient({
      apiKey: "k",
      fetch: async () =>
        new Response("<html>Bad Gateway</html>", { status: 502 }),
    });
    await expect(c.get("/me", Ok)).rejects.toMatchObject({
      status: 502,
      code: "http.502",
    });
  });

  it("429 có Retry-After: chờ đúng số giây rồi thử lại và thành công", async () => {
    const sleep = vi.fn(async () => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("{}", { status: 429, headers: { "Retry-After": "2" } }),
      )
      .mockResolvedValueOnce(json({ ok: true }));
    const c = createSocialApiClient({ apiKey: "k", fetch: fetchMock, sleep });
    await expect(c.get("/me", Ok)).resolves.toEqual({ ok: true });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("429 không có Retry-After: không thử lại (không dội API)", async () => {
    const sleep = vi.fn(async () => {});
    const fetchMock = vi.fn(async () => new Response("{}", { status: 429 }));
    const c = createSocialApiClient({ apiKey: "k", fetch: fetchMock, sleep });
    await expect(c.get("/me", Ok)).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("429 liên tục: dừng sau maxRetries rồi báo lỗi, không lặp vô hạn", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("{}", { status: 429, headers: { "Retry-After": "1" } }),
    );
    const c = createSocialApiClient({
      apiKey: "k",
      fetch: fetchMock,
      sleep: async () => {},
      maxRetries: 2,
    });
    await expect(c.get("/me", Ok)).rejects.toMatchObject({
      status: 429,
      retryAfter: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("Retry-After lớn hơn trần bị cắt để không treo tiến trình", async () => {
    const sleep = vi.fn(async () => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("{}", {
          status: 429,
          headers: { "Retry-After": "99999" },
        }),
      )
      .mockResolvedValueOnce(json({ ok: true }));
    const c = createSocialApiClient({
      apiKey: "k",
      fetch: fetchMock,
      sleep,
      maxWaitMs: 5000,
    });
    await c.get("/me", Ok);
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it("phản hồi 200 sai hình dạng hoặc không phải JSON → client.invalid_response", async () => {
    const bad = createSocialApiClient({
      apiKey: "k",
      fetch: async () => json({ ok: "có" }),
    });
    await expect(bad.get("/me", Ok)).rejects.toMatchObject({
      code: "client.invalid_response",
    });
    const notJson = createSocialApiClient({
      apiKey: "k",
      fetch: async () => new Response("không phải json", { status: 200 }),
    });
    await expect(notJson.get("/me", Ok)).rejects.toMatchObject({
      code: "client.invalid_response",
    });
  });

  it("lỗi mạng → client.network, không lộ key trong thông báo", async () => {
    const c = createSocialApiClient({
      apiKey: "bi-mat-123",
      fetch: async () => {
        throw new Error("ECONNRESET bi-mat-123");
      },
    });
    const err = await c.get("/me", Ok).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "client.network" });
    expect((err as Error).message).not.toContain("bi-mat-123");
  });

  it("toQuery bỏ giá trị rỗng và mã hoá ký tự đặc biệt", async () => {
    const fetchMock = vi.fn(async () => json({ ok: true }));
    const c = createSocialApiClient({ apiKey: "k", fetch: fetchMock });
    await c.get("/inbox/conversations", Ok, {
      account_id: "a b",
      cursor: "",
      limit: 50,
    });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe(
      "https://api.social-api.ai/v1/inbox/conversations?account_id=a+b&limit=50",
    );
  });
});
