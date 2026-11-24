// Kiểm migration (DB-MIG-003, DB-MIG-008, OPS-DEPLOY-003). Chạy: node scripts/check-migrations.mjs [tệp-khoá-của-main]
//
// 1. BẤT BIẾN: mọi migration ghi trong drizzle/applied.sha256 (đã phát hành/áp lên môi trường chung) phải có đúng băm
//    sha256; sửa, xoá, đổi tên là đỏ. Khoá chỉ được THÊM dòng: đối chiếu với bản khoá của nhánh chính do CI xuất ra tệp
//    (`git show origin/main:drizzle/applied.sha256 > base.lock`); không truyền tệp thì chỉ kiểm bất biến và lint.
//    Script không gọi tiến trình con (BASE-SEC-007): việc chạm git nằm ở bước CI.
// 2. EXPAND/CONTRACT: migration MỚI (chưa có trong khoá) không được `DROP COLUMN`, `DROP TABLE`, `RENAME`, đổi kiểu cột
//    tại chỗ, trừ khi có dòng `-- contract: <phát-hành-trước>` nêu release mà code cũ không còn dùng cột/bảng đó.
//    Tệp `.down.sql` là đường lùi nên được phép DROP.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const LOCK = "drizzle/applied.sha256";

const DESTRUCTIVE = [
  [/\bDROP\s+COLUMN\b/i, "DROP COLUMN"],
  [/\bDROP\s+TABLE\b/i, "DROP TABLE"],
  [/\bRENAME\b/i, "RENAME"],
  [/\bALTER\s+COLUMN\b[^;]*\b(SET\s+DATA\s+)?TYPE\b/i, "đổi kiểu cột tại chỗ"],
];

export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** Đọc khoá: mỗi dòng `<sha256>  <đường dẫn>`; bỏ dòng trống và `#`. */
export function parseLock(text) {
  const out = new Map();
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    const m = /^([0-9a-f]{64})\s+(\S+)$/.exec(t);
    if (!m) throw new Error(`dòng khoá sai định dạng: ${line}`);
    out.set(m[2], m[1]);
  }
  return out;
}

/** Vi phạm tính bất biến: tệp trong khoá bị sửa/mất. `files` = Map đường dẫn → nội dung hiện tại. */
export function immutableViolations(lock, files) {
  const bad = [];
  for (const [path, hash] of lock) {
    const text = files.get(path);
    if (text === undefined) bad.push(`${path}: migration đã áp bị xoá/đổi tên`);
    else if (sha256(text) !== hash)
      bad.push(`${path}: migration đã áp bị sửa (băm không khớp khoá)`);
  }
  return bad;
}

/** Khoá chỉ được thêm dòng: dòng ở `base` phải còn nguyên ở `current`. */
export function lockAppendOnlyViolations(base, current) {
  const bad = [];
  for (const [path, hash] of base) {
    if (current.get(path) !== hash)
      bad.push(`${LOCK}: dòng của ${path} bị sửa hoặc xoá`);
  }
  return bad;
}

/** Lint migration mới (không phải .down.sql, chưa có trong khoá). */
export function lintNewMigration(path, sql) {
  if (path.endsWith(".down.sql")) return [];
  if (/^[ \t]*--[ \t]*contract:[ \t]*\S+/im.test(sql)) return [];
  const code = sql.replace(/--[^\n]*/g, "");
  return DESTRUCTIVE.filter(([re]) => re.test(code)).map(
    ([, name]) =>
      `${path}: ${name} không kèm dòng "-- contract: <phát-hành-trước>" (expand/contract)`,
  );
}

export function readMigrations(root = ".") {
  const dir = join(root, "drizzle");
  const files = new Map();
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith(".sql"))
    .sort())
    files.set(`drizzle/${f}`, readFileSync(join(dir, f), "utf-8"));
  return files;
}

export function check({ root = ".", baseLock } = {}) {
  const lock = parseLock(readFileSync(join(root, LOCK), "utf-8"));
  const files = readMigrations(root);
  const bad = [...immutableViolations(lock, files)];
  if (baseLock) bad.push(...lockAppendOnlyViolations(baseLock, lock));
  for (const [path, sql] of files)
    if (!lock.has(path)) bad.push(...lintNewMigration(path, sql));
  return bad;
}

/** Khoá của nhánh chính từ tệp CI xuất ra; tệp thiếu hoặc rỗng (main chưa có khoá, lần đầu) = không có gì để đối chiếu. */
function baseLockFrom(path) {
  if (!path || !existsSync(path)) return undefined;
  return parseLock(readFileSync(path, "utf-8"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!existsSync(LOCK)) {
    console.error(`thiếu ${LOCK}`);
    process.exit(1);
  }
  const bad = check({ baseLock: baseLockFrom(process.argv[2]) });
  if (bad.length > 0) {
    for (const b of bad) console.error(`✗ ${b}`);
    process.exit(1);
  }
  console.log("migration: bất biến và expand/contract đạt");
}
