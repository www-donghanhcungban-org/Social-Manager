-- Đường lùi của 0006_conversations: MẤT TOÀN BỘ hội thoại và tin nhắn đã lưu (mục hộp thư `inbox_items` giữ nguyên).
-- Backup trước khi lùi trên dữ liệu thật.
DROP TABLE IF EXISTS "messages";
DROP TABLE IF EXISTS "conversations";
-- Xoá dòng sổ để migrator chạy lại 0006 khi deploy lại (created_at = `when` trong meta/_journal.json).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795332352110;
