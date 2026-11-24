/**
 * Hằng số đổi đơn vị tập trung một chỗ (XC-UNITS-009): mã khác không viết `* 1000` hay `/ 1024` trần.
 * Tên biến mang đơn vị (`_ms`, `_s`, `_bytes`).
 */
export const MS_PER_SECOND = 1000;
export const BYTES_PER_KIB = 1024;
export const BYTES_PER_MIB = BYTES_PER_KIB * 1024;

/** Giây (số, có thể lẻ) → mili giây. */
export const secondsToMs = (seconds_s: number): number =>
  seconds_s * MS_PER_SECOND;

/** Mili giây → giây nguyên, làm tròn xuống. */
export const msToSeconds = (ms: number): number =>
  Math.floor(ms / MS_PER_SECOND);

/** Mốc Unix tính bằng giây (như header `x-ratelimit-reset`) → mili giây epoch. */
export const unixSecondsToMs = (unix_s: number): number => secondsToMs(unix_s);

export const mibToBytes = (mib: number): number => mib * BYTES_PER_MIB;
