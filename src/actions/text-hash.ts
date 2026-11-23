import { createHash } from "node:crypto";

/**
 * Băm nội dung tin để đối soát (so băm, không phải giữ nội dung): NFC + cắt khoảng trắng. Đây là băm NỘI DUNG, không phải
 * băm mật khẩu hay khoá (ADR-0006); tệp này được miễn hẹp khỏi luật cấm băm nhanh (BE-AUTH-001).
 */
export const textHashOf = (text: string) =>
  createHash("sha256").update(text.normalize("NFC").trim()).digest("hex");
