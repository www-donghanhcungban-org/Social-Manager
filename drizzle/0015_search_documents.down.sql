-- Đường lùi của 0015_search_documents: MẤT chỉ mục tìm kiếm (bằng chứng giữ nguyên; dựng lại bằng `reindexMissing`).
-- Backup trước khi lùi trên dữ liệu thật.
DROP TABLE IF EXISTS "search_documents";
-- Xoá dòng sổ để migrator chạy lại 0015 khi deploy lại (created_at = `when` trong meta/_journal.json).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795390440494;
