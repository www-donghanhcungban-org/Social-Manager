# RUNBOOK — X-Workspace · cập nhật 2026-11-22 · chủ: chủ dự án

> Mọi lệnh chạy ở thư mục gốc repo trên máy chủ chạy Docker Compose. Không ghi giá trị bí mật ở đây, chỉ ghi nơi đặt chúng. Chưa diễn tập: backup/restore và rollback (đánh dấu "chưa diễn tập" bên dưới) — diễn tập một lần trước khi chạy thật.

## 0. Thông tin nhanh

| Mục                     | Giá trị                                                                                                                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Môi trường              | một môi trường do người triển khai tự đặt (không có staging dựng sẵn)                                                                                                                               |
| Repo / nhánh phát hành  | repo `Social-Manager` · nhánh chính (xem `docs/ops/release-readiness.md`)                                                                                                                           |
| Hạ tầng                 | một máy chủ chạy `docker-compose.yml`: `app` (Next.js + worker nền) và `db` (PostgreSQL 16)                                                                                                         |
| Dashboard / log / trace | chưa có dashboard; log JSON ra stdout của container `app` (`docker compose logs app`)                                                                                                               |
| Kho bí mật              | biến môi trường của shell/CI chạy `docker compose` (`POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `APP_SECRET_KEY`, `BETTER_AUTH_URL`); khoá nhà cung cấp nằm mã hoá trong bảng `provider_connections` |
| Liên hệ trực            | chủ dự án (điền kênh liên lạc khi chạy thật); báo lỗ hổng theo `SECURITY.md`                                                                                                                        |

## 1. Lệnh vận hành (chép-chạy)

### Kiểm tra sức khoẻ

```bash
curl -fsS http://127.0.0.1:3000/api/health
```

Trả `{"status":"ok"}` (HTTP 200) khi CSDL trả lời; `{"status":"degraded"}` (503) khi CSDL lỗi hoặc không trả lời trong 2 giây.

```bash
docker compose ps
```

### Deploy (lần đầu và nâng bản)

Đặt đủ bốn biến bí mật trong shell (thiếu biến nào Compose dừng và nêu tên), rồi:

```bash
git pull --ff-only
```

```bash
docker compose up -d --build
```

Container `app` tự chạy migration (`scripts/migrate.mjs`) trước khi nghe cổng. Theo dõi:

```bash
docker compose logs -f app
```

Dấu hiệu thành công: dòng `migration xong` rồi `worker nền đã chạy`.

### Rollback ứng dụng (chưa diễn tập)

Quay về commit trước rồi dựng lại; CSDL giữ nguyên (migration chỉ thêm, xem mục dưới):

```bash
git checkout <commit-trước>
```

```bash
docker compose up -d --build
```

### Migration CSDL

Áp: tự động khi `app` khởi động; chạy tay:

```bash
docker compose run --rm app node scripts/migrate.mjs
```

Lùi một migration (MẤT dữ liệu của bảng đó, backup trước): chạy file `.down.sql` tương ứng trong `drizzle/`, ví dụ lùi `0004_login_throttle`:

```bash
docker compose exec -T db psql -U social -d social < drizzle/0004_login_throttle.down.sql
```

### Backup và khôi phục (chưa diễn tập)

```bash
docker compose exec -T db pg_dump -U social -d social -Fc > backup-$(date +%F).dump
```

Khôi phục vào CSDL trống rồi kiểm (`/api/health`, đăng nhập thử):

```bash
docker compose exec -T db pg_restore -U social -d social --clean --if-exists < backup-YYYY-MM-DD.dump
```

### Xoay bí mật

- `BETTER_AUTH_SECRET`: đổi giá trị rồi `docker compose up -d`; mọi phiên hiện có mất hiệu lực, người dùng đăng nhập lại.
- `POSTGRES_PASSWORD`: đổi trong CSDL (`ALTER USER social PASSWORD '…'`) rồi đổi biến và `docker compose up -d`.
- `APP_SECRET_KEY`: **chưa có cơ chế xoay.** Đổi khoá làm mọi khoá nhà cung cấp đã lưu không giải mã được; phải nhập lại từng kết nối. Chỉ đổi khi nghi lộ khoá.
- Khoá nhà cung cấp (SocialAPI…): xoá kết nối cũ, tạo kết nối mới ở màn hình Kết nối.

### Tắt worker nền / chạy tách

Đặt `RUN_WORKERS=false` cho container `app` để chỉ phục vụ web (ví dụ khi cần dừng đăng bài tạm thời), rồi `docker compose up -d`.

## 2. Cảnh báo → playbook

Hiện **chưa có hệ thống cảnh báo tự động** (chưa cấu hình alert). Tới lúc có, mỗi alert phải có hàng ở đây. Trong lúc đó, các tín hiệu cần theo dõi và cách xử lý:

| Tín hiệu (nơi xem)                                     | Mức  | Nghĩa là gì                                                 | Bước xử lý                                                                                                | Nếu không hết                                     |
| ------------------------------------------------------ | ---- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `/api/health` trả 503                                  | SEV1 | app không nối được CSDL                                     | 1) `docker compose ps` xem `db` còn chạy 2) `docker compose logs db` 3) khởi động lại `db` rồi `app`      | khôi phục từ backup (mục 1)                       |
| log `không khởi động được worker nền`                  | SEV2 | worker không lên; bài hẹn giờ và đồng bộ không chạy         | 1) đọc `error` ở dòng log 2) kiểm kết nối CSDL, quyền tạo schema `pgboss` 3) `docker compose restart app` | tách web khỏi worker (`RUN_WORKERS`) để chẩn đoán |
| bài ở trạng thái `failed` với `errorCode: interrupted` | SEV3 | tiến trình sập khi đang đăng; bài **không** tự đăng lại     | 1) kiểm trên nền tảng xem bài đã lên chưa 2) nếu chưa, đăng lại thủ công từ màn hình Đăng bài             | —                                                 |
| bài `failed` hàng loạt với cùng mã lỗi nhà cung cấp    | SEV2 | khoá hết hạn/bị thu hồi hoặc nhà cung cấp lỗi               | 1) kiểm khoá ở màn hình Kết nối 2) thử tin nhắn đồng bộ 3) tạo lại kết nối nếu khoá hỏng                  | liên hệ nhà cung cấp                              |
| nhiều phản hồi 429 ở đăng nhập                         | SEV3 | đang bị dò mật khẩu hoặc proxy không đặt `CLIENT_IP_HEADER` | 1) kiểm `CLIENT_IP_HEADER` khớp header proxy ghi đè 2) chặn IP ở proxy/firewall                           | siết rate limit ở proxy                           |
| `docker compose up` dừng "đặt …"                       | —    | thiếu biến bí mật bắt buộc                                  | đặt biến nêu trong thông báo rồi chạy lại                                                                 | —                                                 |

## 3. Chẩn đoán nhanh

```bash
docker compose logs --since 30m app
```

```bash
docker compose exec -T db psql -U social -d social -c "select status, count(*) from posts group by status"
```

```bash
docker compose exec -T db psql -U social -d social -c "select name, state, count(*) from pgboss.job group by 1, 2"
```

## 4. Leo thang

1. Người trực đầu tiên: chủ dự án.
2. Nghi lộ khoá/dữ liệu: làm theo `docs/ops/incident-response.md`, xoay bí mật (mục 1), báo theo `SECURITY.md`.

## Lịch sử

| Ngày       | Thay đổi     | Lý do                         |
| ---------- | ------------ | ----------------------------- |
| 2026-11-22 | bản đầu tiên | MUST BASE-DOC-004 trước đợt 2 |
