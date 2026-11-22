-- Đường lùi của 0009_fk_indexes: chỉ bỏ index (không mất dữ liệu); truy vấn theo khoá ngoại chậm lại tới khi dựng lại.
DROP INDEX IF EXISTS "session_user_id_idx";
DROP INDEX IF EXISTS "account_user_id_idx";
DROP INDEX IF EXISTS "posts_social_account_idx";
DROP INDEX IF EXISTS "messages_workspace_idx";
DROP INDEX IF EXISTS "conversations_workspace_idx";
-- Xoá dòng sổ để migrator chạy lại 0009 khi deploy lại (created_at = `when` trong meta/_journal.json).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795336668250;
