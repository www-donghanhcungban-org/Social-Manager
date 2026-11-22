-- Đường lùi của 0004_login_throttle: mất bộ đếm đăng nhập thất bại (an toàn, bộ đếm tự dựng lại).
DROP TABLE IF EXISTS "login_throttle";
-- Xoá dòng sổ để migrator chạy lại 0004 khi deploy lại (created_at = `when` trong meta/_journal.json).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795321139487;
