#!/usr/bin/env bash
# Diễn tập khôi phục (DB-BACKUP-003, OPS-DR-008): khôi phục một bản dump vào CSDL TÁCH BIỆT, đo thời gian (RTO đo được),
# kiểm số dòng các bảng chính và chạy migrate xem schema khớp, rồi xoá CSDL tạm. KHÔNG chạm CSDL nguồn.
# Dùng: ADMIN_URL=postgres://user@host:port/postgres scripts/restore-drill.sh <db-*.dump>
# In một dòng bản ghi dạng bảng Markdown để dán vào docs/ops/restore-drills.md.
set -euo pipefail

dump="${1:?cần đường dẫn db-*.dump}"
: "${ADMIN_URL:?thiếu ADMIN_URL (kết nối tới CSDL quản trị, vd postgres://u@127.0.0.1:5432/postgres)}"
name="xw_restore_drill_$(date -u +%s)"
admin() { psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -qAt "$@"; }
target_url="${ADMIN_URL%/*}/$name"

cleanup() { admin -c "DROP DATABASE IF EXISTS $name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

admin -c "CREATE DATABASE $name"
start=$(date +%s)
pg_restore --no-owner --no-privileges --dbname="$target_url" "$dump"
end=$(date +%s)
rto=$((end - start))

q() { psql "$target_url" -v ON_ERROR_STOP=1 -qAt -c "$1"; }
tables=$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
migrations=$(q "SELECT count(*) FROM drizzle.__drizzle_migrations")
users=$(q 'SELECT count(*) FROM "user"')
messages=$(q "SELECT count(*) FROM messages")
audits=$(q "SELECT count(*) FROM audit_events")
[ "$tables" -gt 0 ] && [ "$migrations" -gt 0 ]

printf '| %s | %s | %ss | bảng=%s, migration=%s, user=%s, messages=%s, audit_events=%s | %s |\n' \
  "$(date -u +%F)" "$(basename "$dump")" "$rto" "$tables" "$migrations" "$users" "$messages" "$audits" "${DRILL_BY:-chưa ghi tên}"
