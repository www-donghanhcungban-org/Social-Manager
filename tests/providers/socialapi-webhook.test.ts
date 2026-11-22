import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  parseWebhookEvent,
  verifyWebhookSignature,
} from "@/src/providers/socialapi/webhook";

const SECRET = "s".repeat(64);
const NOW = 1_800_000_000_000; // ms
const sign = (ts: number | string, body: string, secret = SECRET) =>
  `sha256=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;
const body = '{"event":"dm.received","data":{}}';

describe("verifyWebhookSignature (V2: HMAC-SHA256 của `<timestamp>.<thân thô>`)", () => {
  const ts = String(NOW / 1000);
  const ok = (
    over: Partial<Parameters<typeof verifyWebhookSignature>[0]> = {},
  ) =>
    verifyWebhookSignature({
      secret: SECRET,
      rawBody: Buffer.from(body),
      timestamp: ts,
      signature: sign(ts, body),
      nowMs: NOW,
      ...over,
    });

  it("chữ ký đúng và timestamp trong dung sai → hợp lệ", () => {
    expect(ok()).toBe(true);
  });

  it("sai khoá, sai thân, sai timestamp đã ký → từ chối", () => {
    expect(ok({ secret: "x".repeat(64) })).toBe(false);
    expect(ok({ rawBody: Buffer.from(body + " ") })).toBe(false);
    expect(ok({ timestamp: String(NOW / 1000 + 1) })).toBe(false);
  });

  it("timestamp lệch quá 5 phút (cả hai phía) bị từ chối dù chữ ký khớp; sát 5 phút còn được", () => {
    for (const delta of [-301, 301]) {
      const t = String(NOW / 1000 + delta);
      expect(ok({ timestamp: t, signature: sign(t, body) })).toBe(false);
    }
    for (const delta of [-300, 300]) {
      const t = String(NOW / 1000 + delta);
      expect(ok({ timestamp: t, signature: sign(t, body) })).toBe(true);
    }
  });

  it("thiếu/rác header → từ chối, không ném lỗi", () => {
    for (const signature of [
      undefined,
      "",
      "sha256=",
      "sha256=zz",
      sign(ts, body).slice(7), // thiếu tiền tố
      "sha256=" + "0".repeat(64),
      "sha256=" + "0".repeat(65),
    ])
      expect(ok({ signature }), String(signature)).toBe(false);
    for (const timestamp of [
      undefined,
      "",
      "abc",
      "-5",
      "1e9",
      "1.5",
      "9".repeat(20),
    ])
      expect(ok({ timestamp }), String(timestamp)).toBe(false);
  });

  it("secret rỗng không bao giờ hợp lệ (kể cả chữ ký tính bằng khoá rỗng)", () => {
    expect(ok({ secret: "", signature: sign(ts, body, "") })).toBe(false);
  });

  it("chữ ký hoa/thường: chỉ chấp nhận hex thường như SocialAPI gửi", () => {
    expect(ok({ signature: sign(ts, body).toUpperCase() })).toBe(false);
  });
});

const envelope = (event: string, data: object) => ({ event, data });
const base = {
  id: "sapi_cmt_1",
  platform: "instagram",
  author: { id: "u1", name: "Lan" },
  content: { text: "Giá bao nhiêu shop?" },
  received_at: "2026-11-22T08:00:00Z",
  account_id: "acc_01HZ",
};

describe("parseWebhookEvent", () => {
  it.each([
    ["comment.received", "comment"],
    ["dm.received", "dm"],
    ["mention.received", "mention"],
  ] as const)("%s → tin %s đúng trường", (event, kind) => {
    expect(parseWebhookEvent(envelope(event, base))).toEqual({
      type: "inbox",
      kind,
      accountExternalId: "acc_01HZ",
      item: {
        externalId: "sapi_cmt_1",
        author: "Lan",
        text: "Giá bao nhiêu shop?",
        receivedAt: new Date("2026-11-22T08:00:00Z"),
      },
    });
  });

  it("review.received lấy id/nội dung/tác giả/thời điểm từ data.review", () => {
    const r = parseWebhookEvent(
      envelope("review.received", {
        account_id: "acc_g",
        change: "new_review",
        review: {
          id: "sapi_rev_9",
          rating: 5,
          text: "Tuyệt vời",
          author: { name: "Minh" },
          created_at: "2026-11-21T10:00:00Z",
          updated_at: "2026-11-21T10:00:00Z",
        },
      }),
    );
    expect(r).toEqual({
      type: "inbox",
      kind: "review",
      accountExternalId: "acc_g",
      item: {
        externalId: "sapi_rev_9",
        author: "Minh",
        text: "Tuyệt vời",
        receivedAt: new Date("2026-11-21T10:00:00Z"),
      },
    });
  });

  it("sự kiện khác (đăng bài, trạng thái DM, tài khoản…) và loại lạ → bỏ qua, không lỗi", () => {
    for (const e of [
      "post.published",
      "dm.status.read",
      "account.connected",
      "x.y",
      "",
    ])
      expect(parseWebhookEvent(envelope(e, base))).toEqual({ type: "ignored" });
  });

  it("thiếu tên tác giả → dùng id; thiếu nội dung → chuỗi rỗng; chuẩn hoá NFC và cắt độ dài", () => {
    const r = parseWebhookEvent(
      envelope("dm.received", {
        ...base,
        author: { id: "u9" },
        content: {},
      }),
    );
    expect(r).toMatchObject({ item: { author: "u9", text: "" } });
    const long = parseWebhookEvent(
      envelope("dm.received", {
        ...base,
        author: { name: "é".repeat(500) },
        content: { text: "a".repeat(20_000) },
      }),
    );
    expect(long).toMatchObject({ item: { text: "a".repeat(10_000) } });
    expect((long as { item: { author: string } }).item.author).toHaveLength(
      200,
    );
    expect((long as { item: { author: string } }).item.author).toBe(
      (long as { item: { author: string } }).item.author.normalize("NFC"),
    );
  });

  it("dữ liệu hỏng → ném lỗi kiểm dữ liệu (để trả 400, không thử lại vô ích)", () => {
    const bad: unknown[] = [
      null,
      "x",
      [],
      { event: "dm.received" },
      { event: "dm.received", data: null },
      envelope("dm.received", { ...base, id: "" }),
      envelope("dm.received", { ...base, id: 5 }),
      envelope("dm.received", { ...base, account_id: "" }),
      envelope("dm.received", { ...base, received_at: "hôm qua" }),
      envelope("dm.received", { ...base, received_at: "2026-11-22T08:00:00" }), // thiếu múi giờ
      envelope("dm.received", { ...base, author: "Lan" }),
      envelope("review.received", { account_id: "a", review: {} }),
      envelope("review.received", {
        account_id: "a",
        review: { id: "r", created_at: "x" },
      }),
    ];
    for (const b of bad)
      expect(() => parseWebhookEvent(b), JSON.stringify(b)).toThrow();
  });

  it("không bị __proto__/constructor trong JSON đánh lừa", () => {
    const evil = JSON.parse(
      '{"event":"dm.received","__proto__":{"event":"post.published"},"data":{"id":"i","account_id":"a","received_at":"2026-11-22T08:00:00Z","author":{"name":"n"},"content":{"text":"t"}}}',
    );
    expect(parseWebhookEvent(evil)).toMatchObject({
      type: "inbox",
      kind: "dm",
    });
  });
});
