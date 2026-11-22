import { describe, expect, it } from "vitest";

import { createRegistry } from "@/src/providers/registry";
import { createDemoProvider } from "@/src/providers/demo";
import { socialApiProvider } from "@/src/providers/socialapi";
import type { SocialProvider } from "@/src/providers/types";

const fake = (
  id: string,
  support: SocialProvider["support"],
): SocialProvider => ({
  id,
  label: id,
  support,
});

describe("registry", () => {
  it("tra cứu provider đã đăng ký theo id", () => {
    const r = createRegistry();
    const p = fake("a", { facebook: ["publish"] });
    r.register(p);
    expect(r.get("a")).toBe(p);
    expect(r.list()).toEqual([p]);
  });

  it("từ chối đăng ký trùng id, không ghi đè lặng lẽ", () => {
    const r = createRegistry();
    r.register(fake("a", {}));
    expect(() => r.register(fake("a", {}))).toThrow(/đã đăng ký/);
  });

  it("get id lạ trả undefined, không ném lỗi", () => {
    expect(createRegistry().get("khong-co")).toBeUndefined();
  });

  it("providersFor chỉ trả provider hỗ trợ đúng (nền tảng, khả năng)", () => {
    const r = createRegistry();
    r.register(fake("a", { facebook: ["publish", "dm"] }));
    r.register(fake("b", { facebook: ["analytics"], tiktok: ["publish"] }));
    expect(r.providersFor("facebook", "publish").map((p) => p.id)).toEqual([
      "a",
    ]);
    expect(r.providersFor("facebook", "analytics").map((p) => p.id)).toEqual([
      "b",
    ]);
    expect(r.providersFor("tiktok", "dm")).toEqual([]);
  });

  it("giữ thứ tự đăng ký để làm thứ tự ưu tiên", () => {
    const r = createRegistry();
    r.register(fake("x", { threads: ["publish"] }));
    r.register(fake("y", { threads: ["publish"] }));
    expect(r.providersFor("threads", "publish").map((p) => p.id)).toEqual([
      "x",
      "y",
    ]);
  });
});

describe("socialApiProvider", () => {
  // Nguồn: https://docs.social-api.ai/platforms/overview (xem ngày 2026-11-22)
  it("Facebook hỗ trợ đăng bài, DM và bình luận nhưng không có đánh giá", () => {
    expect(socialApiProvider.support.facebook).toEqual(
      expect.arrayContaining(["publish", "dm", "comments", "analytics"]),
    );
    expect(socialApiProvider.support.facebook).not.toContain("reviews");
  });

  it("Google Business Profile chỉ có đánh giá, đăng bài và thống kê tổng hợp", () => {
    expect(socialApiProvider.support.google).toEqual(
      expect.arrayContaining(["publish", "reviews"]),
    );
    expect(socialApiProvider.support.google).not.toContain("dm");
  });

  it("Telegram và WhatsApp không đăng bài được", () => {
    expect(socialApiProvider.support.telegram ?? []).not.toContain("publish");
    expect(socialApiProvider.support.whatsapp ?? []).not.toContain("publish");
  });
});

describe("demoProvider", () => {
  it("hỗ trợ mọi khả năng cho mọi nền tảng để chạy thử không cần khoá", () => {
    const demo = createDemoProvider();
    expect(demo.id).toBe("demo");
    expect(demo.support.instagram).toEqual(
      expect.arrayContaining([
        "publish",
        "dm",
        "comments",
        "reviews",
        "mentions",
        "analytics",
      ]),
    );
  });
});
