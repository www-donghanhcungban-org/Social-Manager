-- Đường lùi của 0002_posts: MẤT TOÀN BỘ bài đăng và lịch. Backup trước khi lùi trên dữ liệu thật.
DROP TABLE IF EXISTS "posts";
-- Xoá dòng sổ để migrator chạy lại 0002 khi deploy lại (created_at = `when` trong meta/_journal.json).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795316088322;
