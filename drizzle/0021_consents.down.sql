-- Đường lùi của 0021_consents: MẤT bản ghi đồng ý (bằng chứng tuân thủ — xuất trước khi lùi). Cổng AI đám mây sau khi lùi
-- chạy mã cũ chỉ dựa vào cờ `workspaces.ai_cloud_enabled`. Backup trước khi lùi trên dữ liệu thật.
DROP TABLE IF EXISTS "consents";
-- Xoá dòng sổ để migrator chạy lại 0021 khi deploy lại (created_at = `when` trong meta/_journal.json).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795486405475;
