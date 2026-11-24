# Khôi phục kho blob (bằng chứng) (OPS-DR-008)

Kho: thư mục `BLOB_DIR` (`/data/blobs` trong container, volume `blobdata`), tệp đặt tên theo sha256 nội dung (ADR-0004). Metadata nằm ở Postgres (bảng `evidence_*`), nên **khôi phục CSDL và blob cùng một mốc**: thiếu blob thì đọc bằng chứng báo không tìm thấy dù metadata còn. Bản sao lưu: `blobs-<mốc UTC>.tgz` do `scripts/backup.sh` tạo khi `BLOB_DIR` được đặt.

**Thứ tự:** dừng `app` → khôi phục CSDL ([`restore-database.md`](restore-database.md)) → khôi phục blob (dưới) → bật `app` → smoke.

## Khôi phục

1. Kiểm tính toàn vẹn của bản sao lưu:

```bash
cd <thư-mục-sao-lưu> && sha256sum -c SHA256SUMS-<mốc>
```

2. Giải nén vào volume (tạo thư mục `blobs`; chủ tệp phải là `node`, uid 1000):

```bash
docker compose run --rm --no-deps -v <thư-mục-sao-lưu>:/backup --entrypoint tar app xzf /backup/blobs-<mốc>.tgz -C /data
```

3. Kiểm số tệp và đối chiếu metadata:

```bash
docker compose run --rm --no-deps --entrypoint sh app -c 'find /data/blobs -type f | wc -l'
```

```bash
docker compose exec -T db psql -U social -d social -c "select count(distinct sha256) from evidence_blobs"
```

Hai số cùng bậc (tệp có thể nhiều hơn metadata nếu có tệp mồ côi chưa dọn; ít hơn là thiếu blob: dò tệp thiếu theo sha256 trong `evidence_blobs`).

4. Bật `app` và mở một bằng chứng cũ để kiểm đọc được.

## Chưa diễn tập

Khôi phục blob **chưa diễn tập** trên volume thật (phiên phát triển không có Docker); lệnh `tar` dựa vào cùng hình ảnh `app` đã dùng để sao lưu thủ công trong RUNBOOK cũ. Diễn tập và ghi vào `docs/ops/restore-drills.md` (người chạy ≠ tác giả).
