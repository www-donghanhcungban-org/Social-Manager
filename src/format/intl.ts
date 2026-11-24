/**
 * Định dạng số, ngày giờ bằng Intl (CLDR) theo locale người dùng (XC-I18N-003); lớp UI không tự ghép chuỗi
 * định dạng. Không có hàm tiền vì app không lưu/tính/hiển thị tiền (miễn trừ T-510). Thời điểm lưu là UTC (XC-UNITS-001) nên hiển thị cố định múi UTC và ghi rõ "UTC" cho tới khi có cài
 * đặt múi giờ người dùng.
 */
import { MS_PER_SECOND } from "./units";

export const DEFAULT_LOCALE = "vi-VN";

export function formatNumber(
  value: number,
  locale: string = DEFAULT_LOCALE,
  opts?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, opts).format(value);
}

export function formatDate(d: Date, locale: string = DEFAULT_LOCALE): string {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/** Ngày giờ ngắn kèm "UTC": `13/10/2026, 07:14 UTC` (vi-VN). */
export function formatDateTime(
  d: Date,
  locale: string = DEFAULT_LOCALE,
): string {
  const text = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hourCycle: "h23",
  }).format(d);
  return `${text} UTC`;
}

/** Thời gian tương đối ("2 giờ trước") từ mili giây chênh lệch so với `now_ms`. */
export function formatRelative(
  at_ms: number,
  now_ms: number,
  locale: string = DEFAULT_LOCALE,
): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const diff_s = Math.round((at_ms - now_ms) / MS_PER_SECOND);
  const abs = Math.abs(diff_s);
  if (abs < 60) return rtf.format(diff_s, "second");
  if (abs < 3600) return rtf.format(Math.round(diff_s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff_s / 3600), "hour");
  return rtf.format(Math.round(diff_s / 86400), "day");
}
