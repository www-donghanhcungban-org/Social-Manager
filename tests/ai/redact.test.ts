import { describe, expect, it } from "vitest";

import { detectPii, redactPii, totalRedactions } from "@/src/ai/redact";

/** Số di động mẫu ghép từ hai nửa để không có chuỗi số thật trong mã (QA-DATA-002). */
const PHONE = ["091", "2345678"].join("");

/** Bộ mẫu PII tiếng Việt (CMP-PRIV-010, AI-GUARD-004): SĐT, CCCD 12 số, email, địa chỉ. */
describe("che PII tiếng Việt trước khi gửi mô hình", () => {
  it.each([
    PHONE,
    "+84 912 345 678",
    "0912.345.678",
    "0912-345-678",
    "028 3822 1234",
    "84912345678",
  ])("che số điện thoại %s", (phone) => {
    const r = redactPii(`Liên hệ ${phone} nhé`);
    expect(r.text).toBe("Liên hệ [SĐT] nhé");
    expect(r.counts.phone).toBe(1);
  });

  it("che CCCD 12 số, không nhầm thành số điện thoại", () => {
    const r = redactPii("CCCD 079201001234 của khách");
    expect(r.text).toBe("CCCD [CCCD] của khách");
    expect(r.counts).toMatchObject({ cccd: 1, phone: 0 });
  });

  it("che email, kể cả có dấu + và tên miền nhiều cấp", () => {
    const r = redactPii("Gửi tới an.nguyen+shop@example.org giúp");
    expect(r.text).toBe("Gửi tới [EMAIL] giúp");
    expect(r.counts.email).toBe(1);
  });

  it.each([
    [
      "Giao tới 25 Nguyễn Trãi, quận 5, TP Hồ Chí Minh nhé",
      "Giao tới [ĐỊA CHỈ] nhé",
    ],
    ["Địa chỉ 12/3 Lê Lợi phường Bến Nghé", "Địa chỉ [ĐỊA CHỈ]"],
    ["Nhà ở 7B đường Hoàng Diệu, quận Tân Bình", "Nhà ở [ĐỊA CHỈ]"],
  ])("che địa chỉ có số nhà và đơn vị hành chính: %s", (input, out) => {
    const r = redactPii(input);
    expect(r.text).toBe(out);
    expect(r.counts.address).toBe(1);
  });

  it("không che số tiền, ngày, mã đơn, số lượng (không phải PII)", () => {
    for (const s of [
      "Giá 1.500.000 đồng một bó",
      "Giảm 10% đơn từ 5 bó, đặt trước 15/10",
      "Mã đơn #123456 và 20261013",
      "Tặng 25 bó hoa, quận 5 đang giảm giá",
      "Hotline nội bộ 1900 1234",
      "Số dài 0792010012345 không phải CCCD",
    ])
      expect(redactPii(s).text, s).toBe(s);
  });

  it("đếm theo nhóm, không giữ nội dung đã che; chạy lại không đổi (lũy đẳng)", () => {
    const raw = `KH ${PHONE}, email a@example.com, CCCD 079201001234, ở 25 Nguyễn Trãi, quận 5`;
    const r = redactPii(raw);
    expect(r.counts).toEqual({ email: 1, cccd: 1, phone: 1, address: 1 });
    expect(totalRedactions(r.counts)).toBe(4);
    for (const secret of [
      PHONE,
      "a@example.com",
      "079201001234",
      "Nguyễn Trãi",
    ])
      expect(r.text).not.toContain(secret);
    expect(redactPii(r.text).text).toBe(r.text);
    expect(JSON.stringify(r.counts)).not.toMatch(/\d{6,}/);
  });

  it("ca biên: chuỗi rỗng và toàn khoảng trắng", () => {
    expect(redactPii("").text).toBe("");
    expect(redactPii("   ").text).toBe("   ");
    expect(detectPii("không có gì")).toEqual([]);
    expect(detectPii(`gọi ${PHONE}`)).toEqual(["phone"]);
  });
});
