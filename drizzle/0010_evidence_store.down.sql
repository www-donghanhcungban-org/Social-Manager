-- Đường lùi của 0010_evidence_store: MẤT TOÀN BỘ metadata kho bằng chứng (nội dung ở BlobStore/thư mục volume không bị
-- xoá — dọn tay nếu cần). Backup trước khi lùi trên dữ liệu thật.
DROP TABLE IF EXISTS "evidence_items";
DROP TABLE IF EXISTS "evidence_blobs";
-- Xoá dòng sổ để migrator chạy lại 0010 khi deploy lại (created_at = `when` trong meta/_journal.json).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795362062851;
