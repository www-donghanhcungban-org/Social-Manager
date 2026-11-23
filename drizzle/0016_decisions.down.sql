-- Đường lùi của 0016_decisions: MẤT TOÀN BỘ sổ quyết định của các dự án (bằng chứng nguồn giữ nguyên). Backup trước khi lùi.
DROP TABLE IF EXISTS "decisions";
-- Xoá dòng sổ để migrator chạy lại 0016 khi deploy lại (created_at = `when` trong meta/_journal.json).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795390738267;
