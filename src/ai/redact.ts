/**
 * Che thông tin nhận dạng cá nhân (PII) trong văn bản tự do TRƯỚC khi gửi tới mô hình ngoài máy (CMP-PRIV-010,
 * AI-GUARD-004). Hàm thuần, tất định, không I/O. Che theo mẫu — không bắt được mọi PII (tên người, địa chỉ viết lạ):
 * đây là lớp phòng thủ thêm, không thay cho việc chỉ bật AI đám mây khi owner đồng ý (ADR-0005).
 *
 * Nhóm che: email · số căn cước 12 số (CCCD) · số điện thoại Việt Nam (di động và bàn) · địa chỉ có số nhà kèm đơn vị
 * hành chính (heuristic). CMND 9 số không che: trùng quá nhiều với số thường (mã đơn, số tiền).
 *
 * Giới hạn đã biết: nguồn đưa vào lời nhắc là ĐOẠN TRÍCH quanh chỗ khớp (bán kính 80 ký tự, `src/search/service.ts`), nên
 * một PII bị cắt ngay ở mép đoạn trích (vd địa chỉ mất phần "quận …") không khớp mẫu và còn lại một phần. Chuỗi liền như
 * số điện thoại, CCCD, email nằm trọn trong đoạn hay bị cắt cả — phần bị cắt không thành mẫu hợp lệ nên không lộ đủ.
 */
export const PII_KINDS = ["email", "cccd", "phone", "address"] as const;
export type PiiKind = (typeof PII_KINDS)[number];

export const PII_TOKEN: Record<PiiKind, string> = {
  email: "[EMAIL]",
  cccd: "[CCCD]",
  phone: "[SĐT]",
  address: "[ĐỊA CHỈ]",
};

const EMAIL =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const CCCD = /(?<![\d.,/-])\d{12}(?!\d)/g;
/** `0912345678`, `+84 912 345 678`, `0912.345.678`, `028 3822 1234`: 9-11 chữ số, không dính số dài hơn. */
const PHONE =
  /(?<![\d.,/-])(?:\+84|84|0)[\s.-]?[2-9](?:[\s.-]?\d){7,9}(?![\d])/g;
/**
 * Số nhà + tên đường/phố (tuỳ chọn tiền tố đường/phố/ngõ/hẻm) + đơn vị hành chính (phường/quận/huyện/xã/thị xã/tp).
 * Yêu cầu có đơn vị hành chính để không che nhầm "25 bó hoa".
 */
const ADMIN = String.raw`(?:[Pp]hường|[Qq]uận|[Hh]uyện|[Tt]hị xã|[Xx]ã|[Tt][Pp]\.?|[Tt]hành phố)`;
/** Tên đơn vị: một từ/số rồi tối đa hai từ viết hoa nữa ("quận 5", "quận Tân Bình", "TP Hồ Chí Minh"). */
const UNIT = String.raw`[\p{L}\d]+(?:\s+\p{Lu}\p{L}*){0,2}`;
// Không dùng cờ `i`: với `i`, `\p{Lu}` khớp cả chữ thường và "25 bó hoa, quận 5" bị che nhầm.
const ADDRESS = new RegExp(
  String.raw`(?<![\p{L}\d])\d{1,4}[A-Za-z]?(?:[/-]\d{1,4})*\s+(?:(?:[Đđ]ường|[Pp]hố|[Nn]gõ|[Hh]ẻm|[Nn]gách)\s+)?\p{Lu}\p{L}*(?:\s+\p{Lu}\p{L}*){0,3}(?:\s*,\s*|\s+)${ADMIN}\s+${UNIT}(?:\s*,\s*(?:${ADMIN}|[Tt]ỉnh)\s+${UNIT})*`,
  "gu",
);

export interface Redaction {
  text: string;
  /** Số lần che theo nhóm — chỉ đếm, không giữ nội dung đã che. */
  counts: Record<PiiKind, number>;
}

export function redactPii(input: string): Redaction {
  const counts: Record<PiiKind, number> = {
    email: 0,
    cccd: 0,
    phone: 0,
    address: 0,
  };
  const apply = (text: string, kind: PiiKind, re: RegExp) =>
    text.replace(re, () => {
      counts[kind]++;
      return PII_TOKEN[kind];
    });
  // Thứ tự: email trước (chứa số), CCCD 12 số trước số điện thoại (không cho điện thoại ăn một phần CCCD), địa chỉ sau.
  let text = apply(input, "email", EMAIL);
  text = apply(text, "cccd", CCCD);
  text = apply(text, "phone", PHONE);
  text = apply(text, "address", ADDRESS);
  return { text, counts };
}

/** Văn bản có chứa PII thuộc nhóm nào (để quét dataset/log trong test). */
export function detectPii(input: string): PiiKind[] {
  const { counts } = redactPii(input);
  return PII_KINDS.filter((k) => counts[k] > 0);
}

export const totalRedactions = (c: Record<PiiKind, number>): number =>
  PII_KINDS.reduce((s, k) => s + c[k], 0);
