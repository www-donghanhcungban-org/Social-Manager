/**
 * Logger có cấu trúc: một JSON mỗi dòng, ghi ra callback (mặc định stdout), không tự ghi file.
 * - Trường lõi theo OTel (BASE-ERR-006); trường gọi truyền vào không ghi đè được.
 * - Che khoá nhạy cảm và mật khẩu trong chuỗi kết nối (BASE-ERR-007).
 * - Escape CR/LF/ký tự điều khiển chống log injection (BASE-ERR-008).
 * - Ngoại lệ ghi exception.* kèm chuỗi nguyên nhân (BASE-ERR-009).
 */

export const LEVELS = {
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21,
} as const;
export type Level = keyof typeof LEVELS;

export type Fields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: Fields): void;
  info(message: string, fields?: Fields): void;
  warn(message: string, fields?: Fields): void;
  error(message: string, fields?: Fields): void;
  fatal(message: string, fields?: Fields): void;
  child(fields: Fields): Logger;
}

export interface LoggerOptions {
  service: string;
  version: string;
  env: string;
  write?: (line: string) => void;
  now?: () => Date;
}

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY =
  /pass(word|wd)?|token|authorization|cookie|secret|key|credential|session/i;
const CONNECTION_PASSWORD = /([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+(@)/gi;
const MAX_DEPTH = 8;
const CORE = new Set([
  "timestamp",
  "level",
  "severity_number",
  "message",
  "service",
  "version",
  "env",
]);

/** Escape ký tự điều khiển thành dạng nhìn thấy được; giữ nguyên Unicode hợp lệ. */
function escapeString(s: string): string {
  return s
    .replace(CONNECTION_PASSWORD, `$1${REDACTED}$2`)
    .replace(/[\u0000-\u001f\u007f]/g, (c) => {
      if (c === "\n") return "\\n";
      if (c === "\r") return "\\r";
      if (c === "\t") return "\\t";
      return `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`;
    });
}

function sanitize(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === "string") return escapeString(value);
  if (value === null || typeof value !== "object") {
    return typeof value === "bigint" ? value.toString() : value;
  }
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[Truncated]";
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((v) => sanitize(v, depth + 1, seen));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[escapeString(k)] = SENSITIVE_KEY.test(k)
        ? REDACTED
        : sanitize(v, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

function describeException(
  err: unknown,
  seen: Set<unknown> = new Set(),
): Fields {
  if (err instanceof Error) {
    seen.add(err);
    const out: Fields = {
      "exception.type": err.name,
      "exception.message": err.message,
      "exception.stacktrace": err.stack ?? `${err.name}: ${err.message}`,
    };
    if (err.cause !== undefined) {
      out["exception.cause"] = seen.has(err.cause)
        ? "[Circular]"
        : describeException(err.cause, seen);
    }
    return out;
  }
  return {
    "exception.type": typeof err,
    "exception.message": typeof err === "string" ? err : safeStringify(err),
  };
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

export function createLogger(opts: LoggerOptions, bound: Fields = {}): Logger {
  const write =
    opts.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = opts.now ?? (() => new Date());

  function emit(level: Level, message: string, fields: Fields = {}) {
    const merged: Fields = { ...bound, ...fields };
    const { error, ...rest } = merged;
    const extra: Fields = {};
    for (const [k, v] of Object.entries(rest)) {
      if (!CORE.has(k)) extra[k] = v;
    }
    const exception = error === undefined ? {} : describeException(error);
    const record = {
      timestamp: now().toISOString(),
      level,
      severity_number: LEVELS[level],
      message: escapeString(String(message)),
      service: opts.service,
      version: opts.version,
      env: opts.env,
      ...(sanitize(extra, 0, new WeakSet()) as Fields),
      ...(sanitize(exception, 0, new WeakSet()) as Fields),
    };
    write(JSON.stringify(record));
  }

  const logger = {
    child: (fields: Fields) => createLogger(opts, { ...bound, ...fields }),
  } as Logger;
  for (const level of Object.keys(LEVELS) as Level[]) {
    logger[level] = (message, fields) => emit(level, message, fields);
  }
  return logger;
}
