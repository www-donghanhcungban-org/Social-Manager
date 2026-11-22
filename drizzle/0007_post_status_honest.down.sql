-- Đường lùi của 0007_post_status_honest: thu về 4 trạng thái cũ theo nghĩa của mã cũ
-- ("published" = nhà cung cấp đã nhận). MẤT sắc thái: submitted/partial thành published, send_unknown thành failed
-- (error_code giữ nguyên, rỗng thì ghi 'send_unknown'). Backup trước khi lùi trên dữ liệu thật.
UPDATE "posts" SET "status" = 'published' WHERE "status" IN ('submitted', 'partial');
UPDATE "posts" SET "status" = 'failed', "error_code" = coalesce("error_code", 'send_unknown') WHERE "status" = 'send_unknown';
ALTER TABLE "posts" DROP CONSTRAINT "posts_status_check";
ALTER TABLE "posts" ADD CONSTRAINT "posts_status_check" CHECK ("posts"."status" in ('scheduled', 'publishing', 'published', 'failed'));
-- Xoá dòng sổ để migrator chạy lại 0007 khi deploy lại (created_at = `when` trong meta/_journal.json).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795333771467;
