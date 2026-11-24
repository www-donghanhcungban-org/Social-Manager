# Nhật ký diễn tập khôi phục (DB-BACKUP-003, OPS-DR-008)

Mỗi lần diễn tập một dòng: ngày, bản sao lưu dùng, RTO đo được, kiểm tra đã làm, người làm. Lệnh: `scripts/restore-drill.sh` (xem [`runbooks/restore-database.md`](runbooks/restore-database.md) §A). Diễn tập khôi phục **luôn vào CSDL tách biệt**, không chạm CSDL nguồn.

| Ngày       | Bản sao lưu                                                                       | RTO đo (khôi phục) | Kiểm tra đã làm                                                                                                | Người làm               |
| ---------- | --------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 2026-11-24 | `db-20261124T024551Z.dump` (Postgres 16 cục bộ, dữ liệu E2E, `scripts/backup.sh`) | 1s                 | bảng=28, migration=22, user=71, messages=8, audit_events=30; dump qua `pg_restore --list`; `sha256sum -c` khớp | agent (phiên autopilot) |

## Giới hạn của lần diễn tập đầu (nói thật)

- Dữ liệu là bộ E2E nhỏ trên Postgres cục bộ, **không phải** dữ liệu thật; RTO 1 giây không ngoại suy được cho dữ liệu thật. Chủ dự án diễn tập lại trên bản sao dữ liệu thật trước khi ra mắt (`loop defer` ở T-531).
- Người làm là tác giả của script; yêu cầu "người không phải tác giả" của OPS-DR-008 **chưa đạt**.
- Chưa diễn tập khôi phục kho blob, chưa diễn tập trên Docker Compose.
- Thất bại cố ý: `scripts/backup.sh` với CSDL không tồn tại thoát 1, ghi `FAILED` và (nếu đặt `BACKUP_ALERT_WEBHOOK`) gọi cảnh báo — kênh cảnh báo thật chưa nối.
