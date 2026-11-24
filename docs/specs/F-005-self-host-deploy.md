---
status: approved
approved_by: phiên chính (tự duyệt, ADR-0008, D-032)
approved_at: 2026-11-24
feature: F-005
requirements: [R-006]
---

# SPEC F-005 — Triển khai tự host bằng Docker Compose

Trạng thái: Approved for implementation

| Trường       | Giá trị                                                          |
| ------------ | ---------------------------------------------------------------- |
| ID tính năng | F-005 (yêu cầu gốc: R-006)                                       |
| Phiên bản    | 2 — thay đổi: xem cuối file                                      |
| Chủ spec     | phiên chính · Duyệt bởi phiên chính (D-032) ngày 2026-11-24      |
| Hồ sơ/quy mô | web-app / M                                                      |
| Quy ước ID   | `AC-xx` là ID scenario; test ghi `F-005/AC-xx` (xem `README.md`) |

## 1. User story

Là người vận hành biết Docker Compose, tôi muốn dựng ứng dụng và CSDL bằng một lệnh trên máy của mình, để giữ dữ liệu và khoá trong tay, không chạy gì bằng root và không có mật khẩu mặc định.

## 2. Tiêu chí chấp nhận

### AC-01 — Một lệnh compose: CSDL sẵn sàng rồi mới migrate và nhận yêu cầu

- Given máy có Docker và file env đủ biến bắt buộc
- When chạy `docker compose up --build`
- Then service `app` chỉ khởi động khi `db` qua healthcheck (`pg_isready`); container chạy `node scripts/migrate.mjs && exec next start` nên migration xong trước khi nghe cổng

### AC-02 — Migration lũy đẳng

- Given CSDL đã chạy hết migration
- When migrator chạy lại (khởi động lại container)
- Then không áp lại migration nào, sổ `drizzle.__drizzle_migrations` và các bảng giữ nguyên; mỗi migration có tệp `.down.sql`

### AC-03 — Container ứng dụng không chạy bằng root

- Given image production
- When container chạy
- Then tầng cuối có `USER node` (không phải root) đặt trước `CMD`; thư mục dữ liệu được `chown` trước khi đổi người dùng; không dùng `sudo`

### AC-04 — Thiếu hoặc sai biến bắt buộc thì từ chối khởi động (ca lỗi)

- Given thiếu `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` hoặc `APP_SECRET_KEY`, hoặc giá trị sai (rỗng, secret quá ngắn, khoá chủ sai độ dài, URL ngoài không phải https)
- When chạy compose hoặc khởi động ứng dụng
- Then compose dừng ngay (`${VAR:?…}`); ứng dụng in ra stderr tên MỌI biến sai rồi thoát mã 1, không in giá trị

### AC-05 — Không bí mật hay mặc định trong image và cấu hình

- Given mã nguồn, `Dockerfile`, `docker-compose.yml`
- When build image hoặc rà kho
- Then `.dockerignore` loại `.env*`, `.git`, `*.pem`; không cặp tài khoản/mật khẩu mặc định; không cờ tắt xác minh TLS; AI và gửi tin thật mặc định tắt

### AC-06 — Kiểm tra sống và sẵn sàng

- Given ứng dụng đang chạy
- When gọi `/api/health`
- Then 200 `{status:"ok"}` khi CSDL trả lời; CSDL lỗi hoặc treo quá hạn → 503 `{status:"degraded"}` không lộ chi tiết lỗi; image có `HEALTHCHECK` gọi đường này

### AC-07 — Chỉ mở cổng ra loopback

- Given compose mặc định
- When rà cổng publish
- Then mọi cổng chỉ ra `127.0.0.1`; cổng CSDL 5432 không publish; `npm start` ngoài container bind loopback

### AC-08 — Sao lưu và khôi phục theo RUNBOOK

- Given người vận hành theo `docs/RUNBOOK.md`
- When chạy `scripts/backup.sh` theo lịch và diễn tập `scripts/restore-drill.sh`
- Then dump được đọc lại để kiểm, có băm, có xoay vòng; thất bại để lại dấu vết (trap, thoát khác 0); có bản ghi diễn tập khôi phục

## 3. Ca biên

| Nhóm                  | Ca cụ thể                                                 | Hành vi mong đợi                                                                                                                     | AC           |
| --------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| Rỗng/null             | biến rỗng hoặc chỉ khoảng trắng                           | coi như thiếu, từ chối khởi động                                                                                                     | AC-04        |
| Cực đại/độ dài        | secret quá ngắn; khoá chủ sai độ dài                      | từ chối, nêu tên biến                                                                                                                | AC-04        |
| Trùng lặp/idempotency | migration chạy lần hai                                    | không đổi gì                                                                                                                         | AC-02        |
| Song song             | —                                                         | không áp dụng — compose chạy một bản `app`, migrate trong cùng tiến trình trước khi nghe cổng; nhiều bản song song nằm ngoài phạm vi | —            |
| Mất mạng giữa chừng   | CSDL chưa sẵn sàng lúc khởi động; CSDL treo khi kiểm sống | `app` chờ healthcheck của `db`; health trả 503 sau hạn                                                                               | AC-01, AC-06 |
| Thời gian/múi giờ     | kiểm sống treo                                            | 503 sau thời hạn, không treo theo                                                                                                    | AC-06        |
| Quyền                 | tiến trình trong container; cổng mở ra ngoài              | người dùng `node`; chỉ loopback                                                                                                      | AC-03, AC-07 |
| Tiền/đơn vị           | —                                                         | không áp dụng — triển khai không có số tiền hay đơn vị đo                                                                            | —            |

## 4. Dữ liệu

| Thực thể          | Trường                                  | Kiểu   | Ràng buộc                         | Ai đọc/ghi    |
| ----------------- | --------------------------------------- | ------ | --------------------------------- | ------------- |
| volume `dbdata`   | dữ liệu Postgres 16                     | volume | không publish cổng 5432           | service `db`  |
| volume `blobdata` | nội dung kho bằng chứng (`/data/blobs`) | volume | chủ `node`, sao lưu cùng `dbdata` | service `app` |

## 5. Giao diện / API

- `docker-compose.yml` (service `db`, `app`), `Dockerfile` nhiều tầng ghim digest, `scripts/migrate.mjs`, `scripts/backup.sh`, `scripts/restore-drill.sh`, `scripts/smoke.mjs`.
- `GET /api/health` (sẵn sàng, chạm CSDL), `GET /api/health/live` (sống, không chạm gì).

## 6. Lỗi

| Mã lỗi             | Khi nào                 | HTTP/exit code | Thông điệp cho người dùng                                  | AC    |
| ------------------ | ----------------------- | -------------- | ---------------------------------------------------------- | ----- |
| thiếu biến compose | biến bắt buộc không đặt | compose dừng   | "đặt <TÊN_BIẾN> …"                                         | AC-04 |
| cấu hình sai       | biến sai lúc khởi động  | exit 1         | danh sách tên biến sai, không giá trị                      | AC-04 |
| migration lỗi      | migrator ném lỗi        | exit 1         | "migration lỗi: <thông điệp driver>" (không chuỗi kết nối) | AC-01 |
| `degraded`         | CSDL lỗi/treo           | 503            | —                                                          | AC-06 |

## 7. Yêu cầu phi chức năng của tính năng

| Thuộc tính | Ngưỡng                                                       | Nguồn                           | Cách đo                       |
| ---------- | ------------------------------------------------------------ | ------------------------------- | ----------------------------- |
| Bảo mật    | không root, không cổng ngoài loopback, không bí mật mặc định | R-006, BASE-SEC-004/005/006/010 | `tests/config/deploy.test.ts` |
| Vận hành   | smoke sau deploy đỏ khi health ≠ 200 hoặc sai phiên bản      | WF-REL-007                      | `tests/config/smoke.test.ts`  |

## 8. Hành vi AI

- Không dùng model (compose chỉ chuyển biến AI, mặc định tắt).

## 9. Đo lường

- `/api/metrics` (histogram độ trễ) cho người vận hành; không có sự kiện sản phẩm.

## 10. Câu hỏi mở

- [x] Spec cũ ghi image chưa build thật (RK-006); trạng thái đó là rủi ro vận hành, không phải hành vi. — [không chặn] — Đã quyết: D-032 (phiên chính, 2026-11-24) — giữ ở `docs/RISKS.md` RK-006, spec chỉ mô tả hành vi kiểm được bằng test tệp cấu hình.
- [x] Chạy nhiều bản `app` song song (migrate đồng thời) không được nói tới. — [không chặn] — Đã quyết: D-032 (phiên chính, 2026-11-24) — ngoài phạm vi MVP: compose một bản; ghi "không áp dụng" ở mục Ca biên.

## 11. DoR / DoD

- DoR: spec Approved · 0 câu hỏi chặn · phụ thuộc rõ · đủ nhỏ cho một PR · mỗi task có Gate.
- DoD: mọi AC có test chứa `F-005/AC-xx` và xanh · ca biên có test · cổng xanh · blueprint tick có bằng chứng.

## 12. Truy vết

| AC    | Test (tên hoặc chú thích chứa `F-005/AC-xx`)              |
| ----- | --------------------------------------------------------- |
| AC-01 | `tests/config/deploy.test.ts`                             |
| AC-02 | `tests/db/schema.test.ts`                                 |
| AC-03 | `tests/config/deploy.test.ts`                             |
| AC-04 | `tests/config/deploy.test.ts`, `tests/config/env.test.ts` |
| AC-05 | `tests/config/deploy.test.ts`                             |
| AC-06 | `tests/http/health.test.ts`, `e2e/health.spec.ts`         |
| AC-07 | `tests/config/deploy.test.ts`                             |
| AC-08 | `tests/config/runbook.test.ts`                            |

- Task: đợt 0–1 (triển khai), chuẩn hoá spec T-560 · Kiểm: `npx vitest run tests/config/specs.test.ts`.

## Thay đổi

| Phiên bản | Ngày       | Gì                                           | Vì sao                            | Duyệt |
| --------- | ---------- | -------------------------------------------- | --------------------------------- | ----- |
| 1         | 2026-11-22 | tạo (dạng rút gọn)                           | đợt 0–1                           | —     |
| 2         | 2026-11-24 | viết lại theo mẫu khung, AC có ID, theo code | WF-SDD-001..003, PM-SPEC-001..020 | D-032 |
