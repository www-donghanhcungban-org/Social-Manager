-- Đường lùi của 0012_projects: MẤT TOÀN BỘ dự án, bí danh và liên kết nguồn–dự án (hội thoại, bằng chứng giữ nguyên).
-- Backup trước khi lùi trên dữ liệu thật.
DROP TABLE IF EXISTS "project_links";
DROP TABLE IF EXISTS "project_aliases";
DROP TABLE IF EXISTS "projects";
-- Xoá dòng sổ để migrator chạy lại 0012 khi deploy lại (created_at = `when` trong meta/_journal.json).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795363643459;
