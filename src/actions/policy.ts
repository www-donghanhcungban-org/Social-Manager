import type { Platform } from "../providers/types";

/**
 * Chính sách gửi tin bằng MÃ (H12, H13): người nhận, cửa sổ nhắn tin, độ dài và hạn mức do dịch vụ kiểm — mô hình và nội
 * dung tin không quyết được gì ở đây. Hàm thuần: không đọc DB/đồng hồ, mọi đầu vào truyền vào nên kiểm được từng nhánh.
 */
export const BLOCK_REASONS = [
  /** Cờ hệ thống `OUTBOUND_LIVE` đang tắt: không gửi thật. */
  "outbound_disabled",
  /** Owner chưa bật gửi cho workspace. */
  "policy_disabled",
  /** Hội thoại chưa có tin đến nào: không có người để trả lời. */
  "no_incoming_message",
  /** Quá cửa sổ nhắn tin của nền tảng kể từ tin đến cuối. */
  "window_closed",
  "text_too_long",
  "rate_limited",
] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Cửa sổ nhắn tin kể từ tin ĐẾN cuối cùng (research §7): Messenger/Instagram 24 giờ (thẻ Human Agent 7 ngày chưa dùng),
 * Zalo 7 ngày qua API. Nền tảng khác dùng 24 giờ — chọn chặt hơn khi chưa có dữ kiện (AGENTS.md §5).
 */
export const WINDOW_MS: Partial<Record<Platform, number>> = {
  facebook: DAY,
  instagram: DAY,
  zalo: 7 * DAY,
  whatsapp: DAY,
};
export const DEFAULT_WINDOW_MS = DAY;

/** Giới hạn nội dung của nền tảng (research §1): Facebook 2.000 ký tự, Instagram 1.000 byte UTF-8. */
export function textWithinLimit(platform: Platform, text: string): boolean {
  if (platform === "facebook") return Array.from(text).length <= 2000;
  if (platform === "instagram") return Buffer.byteLength(text) <= 1000;
  return true;
}

export interface PolicyInput {
  /** `OUTBOUND_LIVE` của hệ thống. */
  live: boolean;
  workspace: { outboundEnabled: boolean; maxPerHour: number };
  platform: Platform;
  /** Thời điểm tin ĐẾN cuối cùng của hội thoại; null nếu chưa có. */
  lastIncomingAt: Date | null;
  text: string;
  /** Số hành động gửi (còn hiệu lực) của workspace trong 1 giờ qua. */
  sentLastHour: number;
  now: Date;
}

export type PolicyResult = { ok: true } | { ok: false; reason: BlockReason };

/** Thứ tự kiểm cố định: cờ hệ thống → cờ workspace → người nhận → cửa sổ → độ dài → hạn mức. Thất bại ĐÓNG. */
export function evaluateSendPolicy(i: PolicyInput): PolicyResult {
  if (!i.live) return { ok: false, reason: "outbound_disabled" };
  if (!i.workspace.outboundEnabled)
    return { ok: false, reason: "policy_disabled" };
  if (i.lastIncomingAt === null)
    return { ok: false, reason: "no_incoming_message" };
  const window = WINDOW_MS[i.platform] ?? DEFAULT_WINDOW_MS;
  // Đúng biên: cách đúng `window` thì còn trong cửa sổ; quá một mili giây là đóng. Tin đến "ở tương lai" (lệch đồng hồ)
  // coi như vừa đến.
  if (i.now.getTime() - i.lastIncomingAt.getTime() > window)
    return { ok: false, reason: "window_closed" };
  if (!textWithinLimit(i.platform, i.text))
    return { ok: false, reason: "text_too_long" };
  if (i.sentLastHour >= i.workspace.maxPerHour)
    return { ok: false, reason: "rate_limited" };
  return { ok: true };
}
