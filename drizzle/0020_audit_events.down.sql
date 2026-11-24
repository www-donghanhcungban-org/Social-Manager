-- Đường lùi của 0020_audit_events: MẤT audit trail (bằng chứng tuân thủ — xuất trước khi lùi). Backup trước khi lùi trên dữ liệu thật.
DROP TRIGGER IF EXISTS "audit_events_no_truncate" ON "audit_events";
DROP TRIGGER IF EXISTS "audit_events_no_update_delete" ON "audit_events";
DROP TABLE IF EXISTS "audit_events";
DROP FUNCTION IF EXISTS "audit_events_append_only"();
-- Xoá dòng sổ để migrator chạy lại 0020 khi deploy lại (created_at = `when` trong meta/_journal.json).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795479563411;
