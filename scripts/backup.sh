#!/usr/bin/env bash
# Sao lưu X-Workspace (DB-BACKUP-002): dump Postgres + kho blob, băm SHA256, xoay vòng. Chạy theo lịch (cron/systemd
# timer, xem docs/RUNBOOK.md §Backup), KHÔNG phụ thuộc người nhớ chạy. Thất bại: thoát khác 0, ghi FAILED vào thư mục
# sao lưu và gọi webhook cảnh báo nếu BACKUP_ALERT_WEBHOOK được đặt (kênh có người trực do chủ triển khai cấu hình).
#
# Biến: DATABASE_URL (bắt buộc), BACKUP_DIR (mặc định ./backups), BLOB_DIR (mặc định không sao lưu blob nếu trống),
#       BACKUP_KEEP (số bản giữ, mặc định 14), BACKUP_ALERT_WEBHOOK (URL https, tuỳ chọn).
set -euo pipefail

: "${DATABASE_URL:?thiếu DATABASE_URL}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"

alert() {
  echo "SAO LƯU THẤT BẠI: $1" >&2
  printf '%s %s\n' "$stamp" "$1" > "$BACKUP_DIR/FAILED"
  if [ -n "${BACKUP_ALERT_WEBHOOK:-}" ]; then
    case "$BACKUP_ALERT_WEBHOOK" in
      https://*) curl -fsS -m 20 -X POST -H 'Content-Type: application/json' \
        -d "{\"text\":\"X-Workspace: sao lưu thất bại ($stamp): $1\"}" "$BACKUP_ALERT_WEBHOOK" >/dev/null || true ;;
      *) echo "BACKUP_ALERT_WEBHOOK phải là https, bỏ qua cảnh báo" >&2 ;;
    esac
  fi
}
trap 'alert "lệnh lỗi ở dòng $LINENO"' ERR

dump="$BACKUP_DIR/db-$stamp.dump"
pg_dump --format=custom --file="$dump" "$DATABASE_URL"
# Dump rỗng hoặc hỏng thì đỏ ngay, không đợi tới lúc cần khôi phục.
pg_restore --list "$dump" >/dev/null

files=("$dump")
if [ -n "${BLOB_DIR:-}" ] && [ -d "$BLOB_DIR" ]; then
  blobs="$BACKUP_DIR/blobs-$stamp.tgz"
  tar czf "$blobs" -C "$(dirname "$BLOB_DIR")" "$(basename "$BLOB_DIR")"
  files+=("$blobs")
fi

(cd "$BACKUP_DIR" && sha256sum "${files[@]##*/}" > "SHA256SUMS-$stamp")
rm -f "$BACKUP_DIR/FAILED"
echo "sao lưu xong: $stamp (${#files[@]} tệp)"

# Xoay vòng: giữ BACKUP_KEEP bản mới nhất theo từng loại.
shopt -s nullglob
for pattern in 'db-*.dump' 'blobs-*.tgz' 'SHA256SUMS-*'; do
  # Tên có dấu thời gian UTC nên sắp theo tên = sắp theo thời gian; bỏ BACKUP_KEEP bản mới nhất, xoá phần còn lại.
  all=("$BACKUP_DIR"/$pattern)
  if [ "${#all[@]}" -gt "$BACKUP_KEEP" ]; then
    for old in "${all[@]:0:${#all[@]}-BACKUP_KEEP}"; do rm -f -- "$old"; done
  fi
done
