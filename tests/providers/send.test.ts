import { describe, expect, it, vi } from "vitest";

import { sendMessage, supportsSend } from "@/src/providers/actions";
import { createDemoProvider } from "@/src/providers/demo";
import {
  createSocialApiProvider,
  SocialApiError,
} from "@/src/providers/socialapi";
import {
  SendRejectedError,
  UnsupportedError,
  ValidationError,
  type SocialProvider,
} from "@/src/providers/types";

const KEY = "sk-live-SECRET-123";
const input = {
  platform: "facebook" as const,
  accountId: "acc1",
  conversationId: "conv/1",
  text: "Dạ còn ạ",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

function socialapi(fetchImpl: ReturnType<typeof vi.fn>) {
  return createSocialApiProvider({
    apiKey: KEY,
    fetch: fetchImpl as unknown as typeof fetch,
  });
}
const send = (p: SocialProvider) => sendMessage(p, input);

describe("sendMessage qua SocialAPI", () => {
  it("POST /inbox/conversations/{id}/messages với account_id và text; trả message_ids", async () => {
    const f = vi.fn(async () =>
      json({ success: true, message_ids: ["m1", "m2"] }),
    );
    const p = socialapi(f);
    expect(supportsSend(p, "facebook")).toBe(true);
    expect(await send(p)).toEqual({ messageIds: ["m1", "m2"] });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe(
      "https://api.social-api.ai/v1/inbox/conversations/conv%2F1/messages",
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      account_id: "acc1",
      text: "Dạ còn ạ",
    });
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${KEY}`,
    );
  });

  it("Zalo trả message_ids rỗng hoặc chuỗi rỗng: vẫn thành công, danh sách id rỗng", async () => {
    expect(
      await send(
        socialapi(
          vi.fn(async () => json({ success: true, message_ids: [""] })),
        ),
      ),
    ).toEqual({ messageIds: [] });
    expect(
      await send(socialapi(vi.fn(async () => json({ success: true })))),
    ).toEqual({ messageIds: [] });
  });

  it("success:false là nhà cung cấp từ chối chắc chắn", async () => {
    const err = await send(
      socialapi(vi.fn(async () => json({ success: false }))),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SendRejectedError);
    expect(err).toMatchObject({
      code: "provider_declined",
      reason: "rejected",
    });
  });

  it.each([400, 401, 403, 404, 422, 429])(
    "HTTP %i là từ chối chắc chắn (chưa gửi)",
    async (status) => {
      const err = await send(
        socialapi(
          vi.fn(async () => json({ error: { code: "bad_request" } }, status)),
        ),
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SendRejectedError);
      expect((err as SendRejectedError).reason).toBe("rejected");
    },
  );

  it("lỗi cửa sổ nhắn tin được nhận ra: reason window_closed", async () => {
    for (const code of [
      "messaging_window_closed",
      "outside_24h_window",
      "window_expired",
    ]) {
      const err = await send(
        socialapi(
          vi.fn(async () => json({ error: { code, message: "x" } }, 400)),
        ),
      ).catch((e: unknown) => e);
      expect(err, code).toMatchObject({ reason: "window_closed", code });
    }
  });

  it.each([408, 500, 502, 503, 504])(
    "HTTP %i là KHÔNG CHẮC: ném lỗi gốc, không phải SendRejectedError",
    async (status) => {
      const err = await send(
        socialapi(vi.fn(async () => json({}, status))),
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SocialApiError);
      expect(err).not.toBeInstanceOf(SendRejectedError);
    },
  );

  it("mất kết nối, hết giờ, phản hồi không phải JSON/thiếu success là KHÔNG CHẮC", async () => {
    const net = await send(
      socialapi(
        vi.fn(async () => {
          throw new Error(`ECONNRESET ${KEY}`);
        }),
      ),
    ).catch((e: unknown) => e);
    expect(net).toMatchObject({ code: "client.network" });
    expect((net as Error).message).not.toContain(KEY);
    for (const body of ["<html>", JSON.stringify({ message_ids: ["m"] })]) {
      const err = await send(
        socialapi(vi.fn(async () => new Response(body, { status: 200 }))),
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SocialApiError);
      expect((err as SocialApiError).code).toBe("client.invalid_response");
    }
  });

  it("mã lỗi lạ (có thể chứa nội dung) được thay bằng http.<status> trong SendRejectedError", async () => {
    const err = (await send(
      socialapi(
        vi.fn(async () => json({ error: { code: `lộ ${KEY} nội dung` } }, 400)),
      ),
    ).catch((e: unknown) => e)) as SendRejectedError;
    expect(err).toBeInstanceOf(SendRejectedError);
    expect(err.code).toBe("http.400");
    expect(`${err.message} ${err.code}`).not.toContain(KEY);
  });

  it("không tự thử lại: mỗi lần gọi đúng một yêu cầu mạng", async () => {
    const f = vi.fn(async () => json({}, 500));
    await send(socialapi(f)).catch(() => undefined);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("wrapper sendMessage", () => {
  it("từ chối nội dung rỗng và thiếu id trước khi chạm mạng", async () => {
    const f = vi.fn(async () => json({ success: true }));
    const p = socialapi(f);
    for (const over of [
      { text: "" },
      { text: "  \n" },
      { conversationId: "" },
      { accountId: "" },
    ])
      await expect(
        sendMessage(p, { ...input, ...over }),
      ).rejects.toBeInstanceOf(ValidationError);
    expect(f).not.toHaveBeenCalled();
  });

  it("nền tảng không hỗ trợ dm là UnsupportedError; thiếu cài đặt là not_implemented", async () => {
    const none: SocialProvider = { id: "n", label: "n", support: {} };
    await expect(sendMessage(none, input)).rejects.toBeInstanceOf(
      UnsupportedError,
    );
    const lazy: SocialProvider = {
      id: "l",
      label: "l",
      support: { facebook: ["dm"] },
    };
    expect(supportsSend(lazy, "facebook")).toBe(false);
    await expect(sendMessage(lazy, input)).rejects.toMatchObject({
      code: "not_implemented",
    });
  });

  it("demo trả id giả mỗi lần, không đi đâu", async () => {
    const p = createDemoProvider();
    expect(supportsSend(p, "facebook")).toBe(true);
    const a = await sendMessage(p, input);
    const b = await sendMessage(p, input);
    expect(a.messageIds[0]).not.toBe(b.messageIds[0]);
  });
});
