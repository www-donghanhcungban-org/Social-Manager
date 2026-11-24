// Kiểm ngân sách bundle (FE-PERF-004, XC-PERF-003): đọc `perf-budget.json`, đo JS/CSS đã build ở `.next/static`
// (gzip) và thoát mã 1 khi vượt. Tự viết thay `size-limit` để không thêm phụ thuộc (D-026).
// Dùng: `node scripts/check-bundle.mjs` (sau `npm run build`); `--report` chỉ in số đo, không so ngưỡng.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const BYTES_PER_KB = 1000;

function walk(dir) {
  try {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  } catch {
    return [];
  }
}

/** Đo các tệp của một mục ngân sách: trả `{ files: [{path, size_bytes}], total_bytes, max_bytes }`. */
export function measure(entry, root = ".") {
  const files = walk(join(root, entry.dir))
    .filter((f) => entry.exts.some((e) => f.endsWith(e)))
    .map((f) => {
      const buf = readFileSync(f);
      return {
        path: f,
        size_bytes: entry.gzip ? gzipSync(buf).length : buf.length,
      };
    });
  const total_bytes = files.reduce((s, f) => s + f.size_bytes, 0);
  const max_bytes = files.reduce((m, f) => Math.max(m, f.size_bytes), 0);
  return { files, total_bytes, max_bytes };
}

/** So số đo với ngưỡng: trả danh sách vi phạm (rỗng = đạt). Không có tệp nào = vi phạm (build chưa chạy). */
export function violations(budget, measured) {
  const bad = [];
  for (const [i, entry] of budget.entries()) {
    const m = measured[i];
    if (m.files.length === 0) {
      bad.push(
        `${entry.name}: không thấy tệp nào ở ${entry.dir} (chưa build?)`,
      );
      continue;
    }
    const used_bytes = entry.mode === "each" ? m.max_bytes : m.total_bytes;
    const limit_bytes = entry.limit_kb * BYTES_PER_KB;
    if (used_bytes > limit_bytes)
      bad.push(
        `${entry.name}: ${(used_bytes / BYTES_PER_KB).toFixed(1)} kB > ${entry.limit_kb} kB (${entry.mode === "each" ? "tệp lớn nhất" : "tổng"}${entry.gzip ? ", gzip" : ""})`,
      );
  }
  return bad;
}

function main() {
  const report = process.argv.includes("--report");
  const budget = JSON.parse(readFileSync("perf-budget.json", "utf-8")).budgets;
  const measured = budget.map((e) => measure(e));
  for (const [i, e] of budget.entries())
    console.log(
      `${e.name}: tổng ${(measured[i].total_bytes / BYTES_PER_KB).toFixed(1)} kB, lớn nhất ${(measured[i].max_bytes / BYTES_PER_KB).toFixed(1)} kB, ${measured[i].files.length} tệp (ngưỡng ${e.limit_kb} kB ${e.mode})`,
    );
  if (report) return;
  const bad = violations(budget, measured);
  if (bad.length > 0) {
    for (const b of bad) console.error(`✗ ${b}`);
    process.exit(1);
  }
  console.log("✓ trong ngân sách");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
