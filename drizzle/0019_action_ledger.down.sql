-- Đường lùi của 0019_action_ledger: MẤT TOÀN BỘ sổ hành động gửi tin (kể cả dấu vết `send_unknown` đang chờ đối soát —
-- đối soát tay trên nền tảng TRƯỚC khi lùi) và hai cột chính sách gửi của workspace (về mặc định tắt). Backup trước khi lùi.
ALTER TABLE "workspaces" DROP CONSTRAINT IF EXISTS "workspaces_outbound_max_check";
ALTER TABLE "workspaces" DROP COLUMN IF EXISTS "outbound_max_per_hour";
ALTER TABLE "workspaces" DROP COLUMN IF EXISTS "outbound_enabled";
DROP TABLE IF EXISTS "action_ledger";
-- Xoá dòng sổ để migrator chạy lại 0019 khi deploy lại (created_at = `when` trong meta/_journal.json).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795397445294;
