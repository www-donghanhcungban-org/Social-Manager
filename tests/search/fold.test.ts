import { describe, expect, it } from "vitest";

import { fold, foldChar, queryTokens } from "@/src/search/fold";

/** Toàn bộ chữ tiếng Việt có dấu (thường): 67 chữ; hoa: 67 chữ → 134. */
const GROUPS: Record<string, string> = {
  a: "àáảãạăằắẳẵặâầấẩẫậ",
  e: "èéẻẽẹêềếểễệ",
  i: "ìíỉĩị",
  o: "òóỏõọôồốổỗộơờớởỡợ",
  u: "ùúủũụưừứửữự",
  y: "ỳýỷỹỵ",
  d: "đ",
};

describe("bỏ dấu tiếng Việt (H8)", () => {
  const lower = Object.entries(GROUPS).flatMap(([base, chars]) =>
    Array.from(chars).map((c) => [c, base] as const),
  );

  it("đủ 67 chữ thường có dấu và 67 chữ hoa, mỗi chữ về đúng chữ gốc không dấu", () => {
    expect(lower).toHaveLength(67);
    for (const [c, base] of lower) {
      expect(foldChar(c), c).toBe(base);
      expect(foldChar(c.toUpperCase()), c.toUpperCase()).toBe(base);
    }
    expect(lower.length * 2).toBe(134);
  });

  it("đ và Đ về d; chữ không dấu chỉ đổi sang chữ thường", () => {
    expect(fold("Đường Đồng Khởi")).toBe("duong dong khoi");
    expect(fold("ABC xyz 123")).toBe("abc xyz 123");
  });

  it("dạng NFD và NFC cho cùng kết quả", () => {
    const s = "Việt Nam, Cửa hàng Hoa";
    expect(fold(s.normalize("NFD"))).toBe(fold(s.normalize("NFC")));
    expect(fold(s)).toBe("viet nam, cua hang hoa");
  });

  it("mỗi ký tự cho đúng một ký tự: độ dài theo ký tự không đổi (kể cả emoji và chữ ngoài Latin)", () => {
    for (const s of [
      "Người Việt 😀 thích phở",
      "日本語 và Tiếng Việt",
      "ǆ Ǆ ß",
    ]) {
      expect(Array.from(fold(s)).length).toBe(
        Array.from(s.normalize("NFC")).length,
      );
    }
  });

  it("chuỗi rỗng và chỉ dấu câu", () => {
    expect(fold("")).toBe("");
    expect(queryTokens("")).toEqual([]);
    expect(queryTokens("  ,.;:!?()[]'\" ")).toEqual([]);
  });

  it("tách từ bỏ dấu câu, giữ số, giới hạn số từ", () => {
    expect(queryTokens("Cửa-hàng, Hoa #12")).toEqual([
      "cua",
      "hang",
      "hoa",
      "12",
    ]);
    expect(queryTokens("a b c d e f g h i j k l", 10)).toHaveLength(10);
  });
});
