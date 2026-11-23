-- Đường lùi của 0011_evidence_message_link: bỏ liên kết bản sao bằng chứng → tin nhắn. Các bằng chứng nguồn `message`
-- sẽ không còn tự xoá theo tin (hạn lưu không còn đi qua kho): xoá tay chúng trước khi lùi nếu cần tuân thủ hạn lưu.
-- Backup trước khi lùi trên dữ liệu thật.
ALTER TABLE "evidence_items" DROP CONSTRAINT IF EXISTS "evidence_items_message_check";
DROP INDEX IF EXISTS "evidence_items_message_idx";
ALTER TABLE "evidence_items" DROP CONSTRAINT IF EXISTS "evidence_items_message_id_messages_id_fk";
ALTER TABLE "evidence_items" DROP COLUMN IF EXISTS "message_id";
-- Xoá dòng sổ để migrator chạy lại 0011 khi deploy lại (created_at = `when` trong meta/_journal.json).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795362413290;
