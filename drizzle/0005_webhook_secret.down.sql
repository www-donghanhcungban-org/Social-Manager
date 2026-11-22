-- Đường lùi của 0005_webhook_secret: MẤT các secret webhook đã lưu (nhập lại ở màn hình Kết nối khi áp lại).
ALTER TABLE "provider_connections" DROP COLUMN IF EXISTS "webhook_secret_enc";
-- Xoá dòng sổ để migrator chạy lại 0005 khi deploy lại (created_at = `when` trong meta/_journal.json).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795323105279;
