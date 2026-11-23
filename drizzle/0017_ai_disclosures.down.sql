-- Đường lùi của 0017_ai_disclosures: MẤT nhật ký dữ liệu đã gửi tới AI (bằng chứng cho tuân thủ — xuất trước khi lùi) và cờ
-- ai_cloud_enabled (về mặc định tắt). Backup trước khi lùi trên dữ liệu thật.
ALTER TABLE "workspaces" DROP COLUMN IF EXISTS "ai_cloud_enabled";
DROP TABLE IF EXISTS "ai_disclosures";
-- Xoá dòng sổ để migrator chạy lại 0017 khi deploy lại (created_at = `when` trong meta/_journal.json).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795391018815;
