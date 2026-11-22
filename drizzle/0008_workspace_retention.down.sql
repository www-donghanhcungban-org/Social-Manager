-- Đường lùi của 0008_workspace_retention: MẤT cấu hình thời hạn lưu riêng của từng workspace (về mặc định 365 ngày,
-- kể cả workspace đã chọn giữ vô thời hạn — job dọn sau khi lùi sẽ xoá tin quá 365 ngày). Backup trước khi lùi.
ALTER TABLE "workspaces" DROP CONSTRAINT IF EXISTS "workspaces_retention_days_check";
ALTER TABLE "workspaces" DROP COLUMN IF EXISTS "retain_inbox_forever";
ALTER TABLE "workspaces" DROP COLUMN IF EXISTS "inbox_retention_days";
-- Xoá dòng sổ để migrator chạy lại 0008 khi deploy lại (created_at = `when` trong meta/_journal.json).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795334286481;
