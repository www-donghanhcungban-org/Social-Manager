-- Đường lùi của 0000_init: xoá theo thứ tự phụ thuộc khoá ngoại. MẤT TOÀN BỘ DỮ LIỆU các bảng này:
-- chỉ chạy sau khi đã sao lưu (backup trước khi lùi migration trên dữ liệu thật).
DROP TABLE IF EXISTS "social_accounts";
DROP TABLE IF EXISTS "provider_connections";
DROP TABLE IF EXISTS "members";
DROP TABLE IF EXISTS "workspaces";
