-- Đường lùi của 0018_drafts: MẤT TOÀN BỘ bản nháp và lịch sử phiên bản của chúng (tin đã gửi không bị ảnh hưởng). Backup
-- trước khi lùi trên dữ liệu thật.
DROP TABLE IF EXISTS "draft_versions";
DROP TABLE IF EXISTS "drafts";
-- Xoá dòng sổ để migrator chạy lại 0018 khi deploy lại (created_at = `when` trong meta/_journal.json).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795397111165;
