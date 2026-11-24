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

### Smoke test sau deploy (WF-REL-007, OPS-DEPLOY-004)

Chạy ngay sau `docker compose up -d` và sau mỗi rollback, trên URL thật. Kiểm: sống, sẵn sàng (CSDL), phiên bản khớp tag, header bảo mật, trang đăng nhập, `/api/metrics` đóng với người ngoài. Thoát khác 0 = **lùi** (mục Rollback), không báo "đã deploy xong".

```bash
node scripts/smoke.mjs https://<tên-miền-của-bạn> <X.Y.Z>
```

Phiên bản đối chiếu lấy từ `APP_VERSION` lúc dựng image (`APP_VERSION=1.0.0 docker compose up -d --build`); thiếu thì `/api/health` không nêu phiên bản và phép kiểm phiên bản đỏ khi bạn truyền `<X.Y.Z>`.

**Cửa sổ theo dõi và ngưỡng lùi** (người quyết, 15 phút sau deploy): lùi nếu smoke đỏ, `/api/health` 503 quá 2 phút, hoặc tỉ lệ 5xx của `http_server_request_duration_seconds_count` vượt 2% trong cửa sổ (SLO ở `docs/ops/SLO.md`). Chưa có pipeline deploy tự động nên việc lùi là thủ công (chưa tự lùi).

### Rollback ứng dụng (chưa diễn tập)

Bản trước = tag phát hành gần nhất trước bản đang chạy (`git tag --list 'v*' --sort=-v:refname`). Dữ liệu giữ nguyên vì migration chỉ **mở rộng** (thêm cột/bảng; `scripts/check-migrations.mjs` chặn DROP/RENAME không kèm `-- contract:`), nên bản trước chạy được trên schema mới. Trình tự:

1. Kiểm backup mới nhất hợp lệ (`docs/ops/restore-drills.md`), nếu bản cần lùi đã chạy migration chạm dữ liệu.
2. Quay về tag trước rồi dựng lại:

```bash
git checkout v<phiên-bản-trước>
```

```bash
APP_VERSION=<phiên-bản-trước> docker compose up -d --build
```

3. Chạy smoke (mục trên) với phiên bản trước.
4. Migration đi kèm bản bị lùi: giữ nguyên (tương thích ngược); chỉ chạy `.down.sql` khi bản trước **không** chạy được trên schema mới, sau khi backup.

Rollback **chưa diễn tập** trên môi trường thật (phiên phát triển không có Docker). Diễn tập trước lần chạy thật đầu tiên và sau mỗi thay đổi cách deploy.

### Migration CSDL

**Trước migration chạm dữ liệu production (DB-MIG-011):** kiểm có bản sao lưu mới (`ls -t backups/db-*.dump | head -1`, mốc UTC trong vòng 24 giờ; không có thì chạy `scripts/backup.sh`), ghi link/mốc vào mục "Backup trước migrate" của PR, và ghi kế hoạch lùi (xem Rollback). Migration đã phát hành **bất biến** (băm ở `drizzle/applied.sha256`, `scripts/check-migrations.mjs` chạy ở CI); migration mới chỉ mở rộng, đổi/xoá cột theo hai bước expand rồi contract ở phát hành sau (`-- contract: <phát-hành-trước>`).

Áp: tự động khi `app` khởi động; chạy tay:

```bash
docker compose run --rm app node scripts/migrate.mjs
```

Lùi một migration (MẤT dữ liệu của bảng đó, backup trước): chạy file `.down.sql` tương ứng trong `drizzle/`, ví dụ lùi `0004_login_throttle`:

```bash
docker compose exec -T db psql -U social -d social < drizzle/0004_login_throttle.down.sql
```

### Backup và khôi phục theo lịch (DB-BACKUP-002/003, OPS-DR-008)

`scripts/backup.sh` dump Postgres (định dạng custom, kiểm đọc lại được), nén kho blob, ghi `SHA256SUMS-<mốc>`, giữ `BACKUP_KEEP` bản (mặc định 14). Thất bại: thoát khác 0, ghi `FAILED` vào thư mục sao lưu và gọi `BACKUP_ALERT_WEBHOOK` (https, kênh có người trực do bạn đặt) nếu có. Chạy theo lịch, không dựa vào người nhớ — cron trên máy chủ, mỗi ngày 02:30 UTC:

```bash
30 2 * * * cd /đường/dẫn/x-workspace && DATABASE_URL=postgres://… BLOB_DIR=/data/blobs BACKUP_DIR=/var/backups/xw BACKUP_ALERT_WEBHOOK=https://… scripts/backup.sh >> /var/log/xw-backup.log 2>&1
```

Chạy tay một lần để thử:

```bash
DATABASE_URL=postgres://… BACKUP_DIR=./backups scripts/backup.sh
```

Nội dung kho bằng chứng nằm ở volume `blobdata` (`BLOB_DIR=/data/blobs`), **không** nằm trong dump Postgres: script sao lưu cả hai cùng mốc. Mất volume là mất nội dung dù metadata còn (đọc lại sẽ báo không tìm thấy). **Chưa có** kênh cảnh báo có người trực nối sẵn: `BACKUP_ALERT_WEBHOOK` do chủ triển khai đặt; chưa đặt thì chỉ có `FAILED` và exit code.

Khôi phục từng kho, thứ tự, lệnh và cách kiểm: [`ops/runbooks/restore-database.md`](ops/runbooks/restore-database.md) (Postgres, tới mốc sao lưu; PITR chưa bật) và [`ops/runbooks/restore-blobs.md`](ops/runbooks/restore-blobs.md) (kho bằng chứng). Diễn tập vào CSDL tách biệt, đo RTO:

```bash
ADMIN_URL=postgres://… DRILL_BY="tên người chạy" scripts/restore-drill.sh backups/db-<mốc>.dump
```

Bản ghi các lần diễn tập: [`ops/restore-drills.md`](ops/restore-drills.md).

### Diễn tập và hạn (WF-DOC-008)

Trường `last_drilled` của từng mục vận hành: `tests/config/runbook.test.ts` đỏ khi một ngày quá 183 ngày. Mục **chưa diễn tập** ghi `chưa` và vẫn nằm ở danh sách việc chủ dự án.

| Mục                                              | Lệnh/nơi                        | last_drilled | Người                                          |
| ------------------------------------------------ | ------------------------------- | ------------ | ---------------------------------------------- |
| Sao lưu (script chạy được, thất bại có tín hiệu) | `scripts/backup.sh`             | 2026-11-24   | agent (phiên autopilot)                        |
| Khôi phục CSDL vào CSDL tách biệt                | `scripts/restore-drill.sh`      | 2026-11-24   | agent (phiên autopilot)                        |
| Khôi phục kho blob                               | `ops/runbooks/restore-blobs.md` | chưa         | —                                              |
| Deploy lần đầu và nâng bản (Docker)              | mục Deploy                      | chưa         | —                                              |
| Rollback ứng dụng                                | mục Rollback                    | chưa         | —                                              |
| Xoay bí mật                                      | mục Xoay bí mật                 | chưa         | —                                              |
| Smoke sau deploy                                 | `scripts/smoke.mjs`             | 2026-11-24   | agent (phiên autopilot, trên bản build cục bộ) |

### Xoay bí mật

- `BETTER_AUTH_SECRET`: đổi giá trị rồi `docker compose up -d`; mọi phiên hiện có mất hiệu lực, người dùng đăng nhập lại.
- `POSTGRES_PASSWORD`: đổi trong CSDL (`ALTER USER social PASSWORD '…'`) rồi đổi biến và `docker compose up -d`.
- `APP_SECRET_KEY`: **chưa có cơ chế xoay.** Đổi khoá làm mọi khoá nhà cung cấp đã lưu không giải mã được; phải nhập lại từng kết nối. Chỉ đổi khi nghi lộ khoá.
- Khoá nhà cung cấp (SocialAPI…): xoá kết nối cũ, tạo kết nối mới ở màn hình Kết nối.

### Lộ bí mật

Khi phát hiện (gitleaks đỏ, người báo, bí mật xuất hiện trong log/commit/ảnh chụp): **thu hồi trước, dọn sau** — xoá commit không đủ vì bản sao đã tải về vẫn còn. Làm theo thứ tự:

1. Thu hồi và xoay ngay theo loại khoá (lệnh/bước ở mục "Xoay bí mật" phía trên):
   - Mật khẩu CSDL: `docker compose exec -T db psql -U social -d social -c "ALTER USER social PASSWORD '<mới>'"`, đổi `POSTGRES_PASSWORD`, `docker compose up -d`.
   - `BETTER_AUTH_SECRET`: đổi giá trị, `docker compose up -d` (mọi phiên đăng nhập mất hiệu lực — đúng ý muốn).
   - `APP_SECRET_KEY`: đổi khoá rồi nhập lại từng kết nối nhà cung cấp (chưa có cơ chế xoay).
   - Khoá nhà cung cấp (SocialAPI, GitHub, AI): thu hồi tại trang quản lý của nhà cung cấp trước, rồi tạo kết nối/khoá mới.
   - Token GitHub: thu hồi ở Settings → Developer settings; tạo token mới quyền tối thiểu.
2. Rà log và truy cập của khoảng thời gian từ lúc khoá có thể bị lộ đến lúc thu hồi (`docker compose logs --since <thời điểm> app`; trang quản lý nhà cung cấp xem lịch sử gọi) tìm dùng trái phép.
3. Ghi sự cố theo `docs/ops/incident-response.md` (mức, dòng thời gian, phạm vi); mọi vụ lộ đều có post-mortem, kể cả khi không thấy lạm dụng.
4. Dọn nguồn lộ sau cùng: sửa/gỡ nội dung, và chỉ viết lại lịch sử khi chủ dự án quyết (không force-push trong phiên tự động). Bản sao đã lộ coi như đã bị thu thập.
5. Thêm hàng rào chống lặp lại (luật gitleaks, test, bước kiểm) trong cùng PR sửa.

### Tắt worker nền / chạy tách

Đặt `RUN_WORKERS=false` cho container `app` để chỉ phục vụ web (ví dụ khi cần dừng đăng bài tạm thời), rồi `docker compose up -d`.

## 2. Cảnh báo → playbook

Hiện **chưa có hệ thống cảnh báo tự động** (chưa cấu hình alert). Tới lúc có, mỗi alert phải có hàng ở đây. Trong lúc đó, các tín hiệu cần theo dõi và cách xử lý:

| Tín hiệu (nơi xem)                                                                          | Mức  | Nghĩa là gì                                                                                                                | Bước xử lý                                                                                                | Nếu không hết                                     |
| ------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `/api/health` trả 503                                                                       | SEV1 | app không nối được CSDL                                                                                                    | 1) `docker compose ps` xem `db` còn chạy 2) `docker compose logs db` 3) khởi động lại `db` rồi `app`      | khôi phục từ backup (mục 1)                       |
| log `không khởi động được worker nền`                                                       | SEV2 | worker không lên; bài hẹn giờ và đồng bộ không chạy                                                                        | 1) đọc `error` ở dòng log 2) kiểm kết nối CSDL, quyền tạo schema `pgboss` 3) `docker compose restart app` | tách web khỏi worker (`RUN_WORKERS`) để chẩn đoán |
| bài ở trạng thái `send_unknown` (`errorCode: interrupted`, `confirm_timeout`, lỗi mạng/5xx) | SEV3 | tiến trình sập khi đang đăng, mất kết nối giữa chừng hoặc quá 24 giờ nhà cung cấp chưa xác nhận; bài **không** tự đăng lại | 1) kiểm trên nền tảng xem bài đã lên chưa 2) nếu chưa, đăng lại thủ công từ màn hình Đăng bài             | —                                                 |
| bài `failed` hàng loạt với cùng mã lỗi nhà cung cấp                                         | SEV2 | khoá hết hạn/bị thu hồi hoặc nhà cung cấp lỗi                                                                              | 1) kiểm khoá ở màn hình Kết nối 2) thử tin nhắn đồng bộ 3) tạo lại kết nối nếu khoá hỏng                  | liên hệ nhà cung cấp                              |
| nhiều phản hồi 429 ở đăng nhập                                                              | SEV3 | đang bị dò mật khẩu hoặc proxy không đặt `CLIENT_IP_HEADER`                                                                | 1) kiểm `CLIENT_IP_HEADER` khớp header proxy ghi đè 2) chặn IP ở proxy/firewall                           | siết rate limit ở proxy                           |
| `docker compose up` dừng "đặt …"                                                            | —    | thiếu biến bí mật bắt buộc                                                                                                 | đặt biến nêu trong thông báo rồi chạy lại                                                                 | —                                                 |

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

Job nền thử lại tối đa 4 lần (cách nhau mũ có jitter, trần 1 giờ). Hết lượt, hoặc gặp lỗi vĩnh viễn (dữ liệu job sai, 4xx nghiệp vụ), job nằm ở hàng chết `<tên hàng đợi>.dlq` (giữ 30 ngày). Xem tồn đọng bằng truy vấn `pgboss.job` ở trên với `name like '%.dlq'`; cảnh báo tự động và quy trình đưa lại hàng đợi (redrive) **chưa có** (BE-JOB-004 chờ người).

## 4. Leo thang

1. Người trực đầu tiên: chủ dự án.
2. Nghi lộ khoá/dữ liệu: làm theo `docs/ops/incident-response.md`, xoay bí mật (mục 1), báo theo `SECURITY.md`.

## Lịch sử

| Ngày       | Thay đổi     | Lý do                         |
| ---------- | ------------ | ----------------------------- |
| 2026-11-22 | bản đầu tiên | MUST BASE-DOC-004 trước đợt 2 |
