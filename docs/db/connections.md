# Kết nối CSDL (DB-PERF-004, DB-PERF-005)

Cập nhật: 2026-11-23. Nguồn cấu hình: `src/db/client.ts` (`DB_TIMEOUTS`), `src/jobs/pgboss.ts`.

## Bảng tính tổng kết nối

Một tiến trình ứng dụng (một đơn vị triển khai, ADR-0007), chạy cả web và worker nền:

| Thành phần                          | Số kết nối tối đa | Nguồn                                         |
| ----------------------------------- | ----------------- | --------------------------------------------- |
| Pool ứng dụng (`pg.Pool`)           | 10                | `DB_TIMEOUTS.max`                             |
| Pool pg-boss (hàng đợi)             | 5                 | `startBoss` (`max: 5`)                        |
| Dự phòng (migration, psql, sao lưu) | 5                 | quy ước                                       |
| **Tổng cho 1 bản sao**              | **20**            |                                               |
| `max_connections` mặc định Postgres | 100               | `postgres:16` (docker-compose.yml, không đổi) |

Còn dư cho tới 4 bản sao (4 × 15 + 5 dự phòng = 65 ≤ 100). Thêm bản sao thứ năm trở lên: tính lại, hoặc đặt PgBouncer.

## Hạn chờ và giới hạn mỗi phiên

Đặt qua tham số khởi tạo phiên của pool (áp cho mọi kết nối ứng dụng; không đụng `postgresql.conf` toàn cục):

- `connectionTimeoutMillis = 5 s` — chờ lấy/mở kết nối; hết hạn là lỗi, không treo vô hạn.
- `statement_timeout = 30 s`, `query_timeout = 35 s` (phía client), `idle_in_transaction_session_timeout = 60 s` — không giữ khoá hay chặn vacuum.
- `idleTimeoutMillis = 30 s` — trả kết nối rảnh.

## Theo dõi

Chưa có hệ thống cảnh báo tự động. Kiểm tay: `select count(*) from pg_stat_activity` so với `show max_connections`; cần chú ý khi vượt 80%.
