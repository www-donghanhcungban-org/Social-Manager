# Khôi phục CSDL Postgres (OPS-DR-008, DB-BACKUP-003)

Kho: Postgres 16 (container `db`, schema `public`, `drizzle`, `pgboss`). Bản sao lưu: `db-<mốc UTC>.dump` do `scripts/backup.sh` tạo (định dạng custom). **Không có PITR** (chưa bật lưu WAL): mốc khôi phục = mốc của bản sao lưu gần nhất; mất dữ liệu tối đa bằng chu kỳ sao lưu (mặc định 1 ngày). RPO/RTO chốt ở T-542 (việc của chủ dự án).

**Thứ tự phụ thuộc:** (1) dừng `app` để không ghi vào CSDL đang khôi phục → (2) khôi phục CSDL → (3) khôi phục kho blob nếu mất ([`restore-blobs.md`](restore-blobs.md)) → (4) bật `app` (tự chạy migrate) → (5) smoke. Người không phải tác giả chạy được: mọi lệnh bên dưới chép-chạy, biến đặt rõ.

## A. Diễn tập hoặc kiểm bản sao lưu (không chạm CSDL thật)

Khôi phục vào CSDL tạm tách biệt, đo thời gian, kiểm số dòng, rồi tự xoá:

```bash
ADMIN_URL=postgres://<người-dùng>@<máy>:<cổng>/postgres DRILL_BY="<tên người chạy>" scripts/restore-drill.sh <thư-mục-sao-lưu>/db-<mốc>.dump
```

Dòng in ra dán vào `docs/ops/restore-drills.md`. Đạt khi: thoát 0, `bảng` > 0, `migration` bằng số migration của bản phát hành, `user`/`messages`/`audit_events` cùng bậc với môi trường nguồn.

## B. Khôi phục thật (sự cố mất hoặc hỏng dữ liệu)

1. Dừng ứng dụng, giữ `db` chạy:

```bash
docker compose stop app
```

2. **Giữ lại bản hỏng để điều tra** (đổi tên, không xoá):

```bash
docker compose exec -T db psql -U social -d postgres -c "ALTER DATABASE social RENAME TO social_hong_$(date +%Y%m%d)"
```

3. Tạo CSDL mới cùng tên và khôi phục:

```bash
docker compose exec -T db psql -U social -d postgres -c "CREATE DATABASE social"
```

```bash
docker compose exec -T db pg_restore -U social -d social --no-owner --no-privileges < <thư-mục-sao-lưu>/db-<mốc>.dump
```

4. Kiểm trước khi bật lại (đều phải ra số hợp lý):

```bash
docker compose exec -T db psql -U social -d social -c "select count(*) from drizzle.__drizzle_migrations"
```

```bash
docker compose exec -T db psql -U social -d social -c "select count(*) from \"user\""
```

5. Bật ứng dụng (tự chạy migrate để lên đúng schema) rồi chạy smoke:

```bash
docker compose up -d app
```

```bash
node scripts/smoke.mjs https://<tên-miền-của-bạn> <X.Y.Z>
```

6. Ghi sự cố ở `docs/ops/incidents/` (mốc dữ liệu mất, thời gian khôi phục) và thêm bản ghi vào `docs/ops/restore-drills.md` nếu đây là lần đo mới.

## Ghi chú

- `audit_events` có trigger chặn sửa/xoá; `pg_restore` chèn dữ liệu nên không bị chặn.
- Bí mật (`BETTER_AUTH_SECRET`, `APP_SECRET_KEY`) **không** nằm trong dump: giữ chúng ở kho bí mật. Mất `APP_SECRET_KEY` thì khoá nhà cung cấp đã lưu không giải mã được (nhập lại kết nối).
- Hạ tầng dựng lại từ IaC: không áp dụng — repo chỉ có `docker-compose.yml`, không có Terraform/Pulumi.
