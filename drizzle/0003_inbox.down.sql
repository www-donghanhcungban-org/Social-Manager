-- Đường lùi của 0003_inbox: MẤT TOÀN BỘ tin nhắn/bình luận đã nhập. Backup trước khi lùi trên dữ liệu thật.
DROP TABLE IF EXISTS "inbox_items";
-- Xoá dòng sổ để migrator chạy lại 0003 khi deploy lại (created_at = `when` trong meta/_journal.json).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795316464256;
