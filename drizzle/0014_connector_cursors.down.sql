-- Đường lùi của 0014_connector_cursors: MẤT con trỏ nhập của các connector (lượt nhập sau đọc lại từ đầu; bằng chứng
-- đã nhập giữ nguyên và không nhân đôi nhờ khoá duy nhất). Backup trước khi lùi trên dữ liệu thật.
DROP TABLE IF EXISTS "connector_cursors";
-- Xoá dòng sổ để migrator chạy lại 0014 khi deploy lại (created_at = `when` trong meta/_journal.json).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795364849477;
