-- Đường lùi của 0013_source_checkpoints: MẤT mốc đồng bộ và lịch sử lỗi của từng tài khoản (tin nhắn giữ nguyên;
-- lượt đồng bộ sau tạo lại mốc). Backup trước khi lùi trên dữ liệu thật.
DROP TABLE IF EXISTS "source_checkpoints";
-- Xoá dòng sổ để migrator chạy lại 0013 khi deploy lại (created_at = `when` trong meta/_journal.json).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795364279394;
