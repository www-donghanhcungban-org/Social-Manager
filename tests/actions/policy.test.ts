import { describe, expect, it } from "vitest";

import {
  BLOCK_REASONS,
  DEFAULT_WINDOW_MS,
  evaluateSendPolicy,
  textWithinLimit,
  WINDOW_MS,
  type PolicyInput,
} from "@/src/actions/policy";
import { PLATFORMS } from "@/src/providers/types";

const NOW = new Date("2026-11-22T12:00:00Z");
const H = 3_600_000;
const ok = (over: Partial<PolicyInput> = {}): PolicyInput => ({
  live: true,
  workspace: { outboundEnabled: true, maxPerHour: 10 },
  platform: "facebook",
  lastIncomingAt: new Date(NOW.getTime() - H),
  text: "Dạ còn ạ",
  sentLastHour: 0,
  now: NOW,
  ...over,
});
const reason = (over: Partial<PolicyInput>) => {
  const r = evaluateSendPolicy(ok(over));
  return r.ok ? "ok" : r.reason;
};

describe("chính sách gửi", () => {
  it("đủ điều kiện thì cho gửi", () => {
    expect(evaluateSendPolicy(ok())).toEqual({ ok: true });
  });

  it("cờ hệ thống tắt chặn mọi thứ khác (kể cả khi mọi điều kiện khác đều đạt) [F-006/AC-06]", () => {
    expect(reason({ live: false })).toBe("outbound_disabled");
    expect(
      reason({
        live: false,
        workspace: { outboundEnabled: false, maxPerHour: 0 },
      }),
    ).toBe("outbound_disabled");
  });

  it("workspace chưa bật thì chặn", () => {
    expect(
      reason({ workspace: { outboundEnabled: false, maxPerHour: 10 } }),
    ).toBe("policy_disabled");
  });

  it("chưa có tin đến nào: không có người để trả lời", () => {
    expect(reason({ lastIncomingAt: null })).toBe("no_incoming_message");
  });

  it.each([
    ["facebook", 24 * H],
    ["instagram", 24 * H],
    ["whatsapp", 24 * H],
    ["zalo", 7 * 24 * H],
    ["telegram", 24 * H],
  ] as const)(
    "cửa sổ %s: đúng biên còn mở, quá 1 ms thì đóng",
    (platform, window) => {
      expect(
        reason({ platform, lastIncomingAt: new Date(NOW.getTime() - window) }),
      ).toBe("ok");
      expect(
        reason({
          platform,
          lastIncomingAt: new Date(NOW.getTime() - window - 1),
        }),
      ).toBe("window_closed");
    },
  );

  it("Zalo mở 7 ngày nhưng Facebook thì đóng ở 2 ngày [F-006/AC-06]", () => {
    const twoDays = new Date(NOW.getTime() - 48 * H);
    expect(reason({ platform: "zalo", lastIncomingAt: twoDays })).toBe("ok");
    expect(reason({ platform: "facebook", lastIncomingAt: twoDays })).toBe(
      "window_closed",
    );
  });

  it("nền tảng chưa khai cửa sổ dùng mặc định 24 giờ (chặt)", () => {
    for (const p of PLATFORMS.filter((x) => WINDOW_MS[x] === undefined))
      expect(
        reason({
          platform: p,
          lastIncomingAt: new Date(NOW.getTime() - DEFAULT_WINDOW_MS - 1),
        }),
      ).toBe("window_closed");
  });

  it("tin đến ở tương lai (lệch đồng hồ) coi như vừa đến [F-006/AC-06]", () => {
    expect(reason({ lastIncomingAt: new Date(NOW.getTime() + H) })).toBe("ok");
  });

  it("độ dài: Facebook 2000 ký tự, Instagram 1000 byte UTF-8, nền tảng khác không giới hạn thêm [F-006/AC-06]", () => {
    expect(textWithinLimit("facebook", "x".repeat(2000))).toBe(true);
    expect(textWithinLimit("facebook", "x".repeat(2001))).toBe(false);
    expect(textWithinLimit("facebook", "ệ".repeat(2000))).toBe(true); // đếm ký tự, không phải byte
    expect(textWithinLimit("instagram", "x".repeat(1000))).toBe(true);
    expect(textWithinLimit("instagram", "x".repeat(1001))).toBe(false);
    expect(textWithinLimit("instagram", "ệ".repeat(334))).toBe(false); // 334 × 3 byte = 1002
    expect(textWithinLimit("instagram", "ệ".repeat(333))).toBe(true);
    expect(reason({ platform: "facebook", text: "x".repeat(2001) })).toBe(
      "text_too_long",
    );
    expect(reason({ platform: "zalo", text: "x".repeat(4000) })).toBe("ok");
  });

  it("hạn mức giờ: đúng biên; maxPerHour = 0 chặn hết", () => {
    expect(reason({ sentLastHour: 9 })).toBe("ok");
    expect(reason({ sentLastHour: 10 })).toBe("rate_limited");
    expect(reason({ sentLastHour: 11 })).toBe("rate_limited");
    expect(
      reason({ workspace: { outboundEnabled: true, maxPerHour: 0 } }),
    ).toBe("rate_limited");
  });

  it("thứ tự kiểm: cửa sổ đóng được báo trước độ dài và hạn mức [F-006/AC-06]", () => {
    expect(
      reason({
        lastIncomingAt: new Date(NOW.getTime() - 99 * H),
        text: "x".repeat(5000),
        sentLastHour: 99,
      }),
    ).toBe("window_closed");
  });

  it("mọi lý do chặn đều có trong danh sách (không có chuỗi ngoài danh sách)", () => {
    const seen = new Set<string>();
    for (const over of [
      { live: false },
      { workspace: { outboundEnabled: false, maxPerHour: 1 } },
      { lastIncomingAt: null },
      { lastIncomingAt: new Date(0) },
      { text: "x".repeat(2001) },
      { sentLastHour: 99 },
    ] as Partial<PolicyInput>[])
      seen.add(reason(over));
    for (const r of seen) expect([...BLOCK_REASONS, "ok"]).toContain(r);
    expect(seen.size).toBe(6);
  });
});
