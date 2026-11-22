-- Đường lùi của 0001_auth: MẤT TOÀN BỘ tài khoản đăng nhập và phiên. Backup trước khi lùi trên dữ liệu thật.
DROP TABLE IF EXISTS "verification";
DROP TABLE IF EXISTS "account";
DROP TABLE IF EXISTS "session";
DROP TABLE IF EXISTS "user";
-- Xoá dòng sổ để migrator chạy lại 0001 khi deploy lại (created_at = `when` trong meta/_journal.json).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795313726073;
