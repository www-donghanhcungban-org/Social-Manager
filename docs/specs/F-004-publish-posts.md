---
status: approved
approved_by: phiên chính (tự duyệt, ADR-0008, D-032)
approved_at: 2026-11-24
feature: F-004
requirements: [R-005]
---

# SPEC F-004 — Đăng bài ngay và hẹn giờ

Trạng thái: Approved for implementation

| Trường       | Giá trị                                                          |
| ------------ | ---------------------------------------------------------------- |
| ID tính năng | F-004 (yêu cầu gốc: R-005)                                       |
| Phiên bản    | 2 — thay đổi: xem cuối file                                      |
| Chủ spec     | phiên chính · Duyệt bởi phiên chính (D-032) ngày 2026-11-24      |
| Hồ sơ/quy mô | web-app / M                                                      |
| Quy ước ID   | `AC-xx` là ID scenario; test ghi `F-004/AC-xx` (xem `README.md`) |

## 1. User story

Là thành viên workspace, tôi muốn đăng bài lên một trang đã kết nối ngay hoặc hẹn giờ, để lịch đăng chạy kể cả khi tôi tắt máy, mỗi bài lên đúng một lần và trạng thái tôi thấy là sự thật.

## 2. Tiêu chí chấp nhận

### AC-01 — Xếp lịch đăng ngay hoặc hẹn giờ, lưu UTC

- Given thành viên chọn tài khoản của workspace và viết nội dung
- When đăng ngay (không giờ hẹn) hoặc hẹn giờ ISO 8601 có múi giờ
- Then có bài `scheduled`; đăng ngay thì `scheduled_at` = bây giờ; hẹn giờ lưu đúng thời điểm UTC (ví dụ `10:00+07:00` → `03:00Z`); nội dung chuẩn hoá NFC

### AC-02 — Giờ hẹn sai bị từ chối (ca lỗi)

- Given giờ hẹn đã qua, đúng bằng hiện tại, không phải ISO, thiếu múi giờ, hoặc ngày không có thật
- When xếp lịch
- Then `ValidationError`, không ghi bài nào

### AC-03 — Nội dung và khoá idempotency sai bị từ chối (ca lỗi)

- Given nội dung rỗng/chỉ khoảng trắng, hoặc khoá idempotency rỗng hay dài hơn 128 ký tự
- When xếp lịch
- Then `ValidationError` (CSDL cũng có CHECK nội dung khác rỗng)

### AC-04 — Gửi lại cùng khoá không tạo bài thứ hai

- Given bài đã xếp với khoá idempotency K
- When gửi lại cùng K (tuần tự hoặc hai yêu cầu song song)
- Then trả đúng bài cũ, chỉ có một bài; cùng K mà nội dung hay tài khoản khác là `ConflictError idempotency_conflict`, không ghi đè

### AC-05 — Hàng đợi nền đăng mỗi bài đúng một lần

- Given bài `scheduled` đã đến hạn (kể cả đúng ranh giới giờ hẹn)
- When job `runDue` chạy mỗi phút, chạy lại, hoặc hai worker chạy song song
- Then bài được nhận bằng `FOR UPDATE SKIP LOCKED` (chuyển `publishing`, tăng `attempts`), nhà cung cấp được gọi đúng một lần; đăng theo thứ tự giờ hẹn, tôn trọng `limit`; bài chưa đến hạn không bị đăng

### AC-06 — Trạng thái phản ánh đúng kết quả, không tự đăng lại (ca lỗi)

- Given nhà cung cấp trả kết quả hoặc lỗi
- When worker xử lý bài
- Then chỉ `published` của nhà cung cấp mới thành `published` (kèm `published_at`); `submitted`/`scheduled` thành `submitted` chờ xác nhận; lỗi chắc chắn (4xx, provider không còn đăng ký, khoá hỏng) thành `failed` với mã ngắn không chứa nội dung lỗi; hết giờ, đứt mạng, 5xx, phản hồi 2xx đọc không được thành `send_unknown`; không bài nào tự đăng lại; một bài hỏng không chặn bài khác

### AC-07 — Tiến trình chết giữa chừng thì bài thành chưa rõ

- Given bài kẹt `publishing` quá 15 phút (worker chết)
- When job `recoverStuck` chạy (mỗi 5 phút)
- Then bài chuyển `send_unknown` mã `interrupted` để người quyết định; không gọi lại nhà cung cấp; bài chưa quá hạn giữ nguyên

### AC-08 — Xác nhận bài đã gửi, quá 24 giờ thì chưa rõ

- Given bài `submitted`
- When job `confirmSubmitted` chạy (mỗi 2 phút, hạn 24 giờ)
- Then nhà cung cấp báo `published`/`partial` → trạng thái đó kèm `published_at`; `failed`/`cancelled` → `failed`; còn `pending`, lỗi mạng hoặc trạng thái lạ → giữ `submitted`; quá 24 giờ chưa có kết quả cuối → `send_unknown` mã `confirm_timeout`, không đăng lại

### AC-09 — Người ngoài và tài khoản lạ bị chặn (ca lỗi)

- Given người không thuộc workspace, hoặc tài khoản của workspace khác hay id không phải UUID
- When xếp lịch hoặc xem danh sách bài
- Then người ngoài bị Forbidden; tài khoản không thuộc workspace là NotFound; không ghi bài nào

## 3. Ca biên

| Nhóm                  | Ca cụ thể                                               | Hành vi mong đợi                                                        | AC                         |
| --------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------- |
| Rỗng/null             | nội dung rỗng/khoảng trắng; khoá rỗng; không có giờ hẹn | từ chối; không giờ hẹn = đăng ngay                                      | AC-01, AC-03               |
| Cực đại/độ dài        | khoá > 128 ký tự; nhiều bài đến hạn hơn `limit`         | từ chối khoá; mỗi lượt đăng tối đa `limit` bài                          | AC-03, AC-05               |
| Trùng lặp/idempotency | gửi lại cùng khoá; worker chạy lại                      | một bài; nhà cung cấp được gọi một lần                                  | AC-04, AC-05               |
| Song song             | hai yêu cầu cùng khoá; hai worker cùng lúc              | một bài; không đăng trùng                                               | AC-04, AC-05               |
| Mất mạng giữa chừng   | hết giờ/đứt mạng khi đăng; worker chết khi `publishing` | `send_unknown`, không tự đăng lại                                       | AC-06, AC-07               |
| Thời gian/múi giờ     | giờ hẹn có offset; quá khứ; đúng ranh giới; hạn 24 giờ  | lưu UTC; từ chối quá khứ; đến hạn thì đăng; quá hạn → `confirm_timeout` | AC-01, AC-02, AC-05, AC-08 |
| Quyền                 | người ngoài; tài khoản của workspace khác               | Forbidden / NotFound                                                    | AC-09                      |
| Tiền/đơn vị           | —                                                       | không áp dụng — đăng bài không có số tiền hay đơn vị đo                 | —                          |

## 4. Dữ liệu

| Thực thể | Trường                                                                                                                     | Kiểu                 | Ràng buộc                                                                                | Ai đọc/ghi                                |
| -------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------- |
| `posts`  | `text`, `status`, `scheduled_at`, `claimed_at`, `published_at`, `external_id`, `error_code`, `attempts`, `idempotency_key` | text/timestamptz/int | UNIQUE (workspace, khoá); `status` ∈ 7 giá trị (CHECK); `text` khác rỗng; `attempts ≥ 0` | thành viên tạo/xem; worker ghi trạng thái |

- Trạng thái: `scheduled` → `publishing` → `published` | `submitted` → (`published` | `partial` | `failed` | `send_unknown`); `publishing` → `failed` | `send_unknown`.

## 5. Giao diện / API

- Trang `/app/<workspace>/posts`: chọn tài khoản, nội dung, giờ hẹn (bỏ trống = đăng ngay); form sinh khoá idempotency mới sau mỗi lần thành công; chưa có tài khoản thì hướng dẫn thêm (e2e `posts.spec.ts`).
- Job pg-boss: `runDue` (mỗi phút), `recoverStuck` (5 phút, ngưỡng 15 phút), `confirmSubmitted` (2 phút, hạn 24 giờ).

## 6. Lỗi

| Mã lỗi                          | Khi nào                                                                                                                                         | HTTP/exit code    | Thông điệp cho người dùng                                            | AC                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------- | ------------------- |
| `validation`                    | giờ hẹn/nội dung/khoá sai                                                                                                                       | `ValidationError` | "Giờ hẹn phải ở tương lai" …                                         | AC-02, AC-03        |
| `conflict/idempotency_conflict` | cùng khoá, yêu cầu khác                                                                                                                         | `ConflictError`   | "Khoá idempotency đã dùng cho yêu cầu khác"                          | AC-04               |
| `forbidden` / `not_found`       | người ngoài / tài khoản lạ                                                                                                                      | lỗi dịch vụ       | "Bạn không có quyền đăng bài." / "Không tìm thấy tài khoản đã chọn." | AC-09               |
| `error_code` của bài            | `http.<status>`, `internal`, `provider_unavailable`, `credentials_unreadable`, `interrupted`, `confirm_timeout`, `cancelled`, `upstream_failed` | lưu ở bài         | hiển thị trạng thái và mã                                            | AC-06, AC-07, AC-08 |

## 7. Yêu cầu phi chức năng của tính năng

| Thuộc tính | Ngưỡng                                                           | Nguồn       | Cách đo                                                                                     |
| ---------- | ---------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| Tin cậy    | 0 bài trùng khi chạy lặp/song song                               | R-005       | `tests/posts/service.test.ts`, `tests/jobs/pgboss.integration.test.ts` (Postgres thật ở CI) |
| Bảo mật    | mã lỗi chỉ `[a-z0-9_.-]{1,64}`, không nội dung phía nhà cung cấp | ASVS 5.0 L2 | `tests/posts/service.test.ts`                                                               |

## 8. Hành vi AI

- Không dùng model.

## 9. Đo lường

- Log kết quả mỗi lượt job (`published`, `failed`, `send_unknown`…); chưa có chỉ số sản phẩm riêng.

## 10. Câu hỏi mở

- [x] Spec cũ ghi "thử lại có giới hạn"; code không tự đăng lại bài nào: lỗi chắc chắn → `failed`, lỗi không chắc → `send_unknown` để người quyết. — [không chặn] — Đã quyết: D-032 (phiên chính, 2026-11-24) — spec theo code (AC-06), vì đăng lại khi chưa rõ có thể thành hai bài (R-005).
- [x] Spec cũ dùng nhãn `đang đăng/đã đăng/lỗi/chưa rõ`; code có 7 trạng thái (`scheduled`, `publishing`, `submitted`, `published`, `partial`, `failed`, `send_unknown`) và ngưỡng kẹt 15 phút. — [không chặn] — Đã quyết: D-032 (phiên chính, 2026-11-24) — spec theo code (mục 4, AC-07).
- [x] Spec cũ nêu ca "nội dung quá dài"; code không đặt trần độ dài nội dung, giới hạn thật do nhà cung cấp trả lỗi (→ `failed`). — [không chặn] — Đã quyết: D-032 (phiên chính, 2026-11-24) — giữ hành vi hiện tại; trần theo nền tảng để backlog.

## 11. DoR / DoD

- DoR: spec Approved · 0 câu hỏi chặn · phụ thuộc rõ · đủ nhỏ cho một PR · mỗi task có Gate.
- DoD: mọi AC có test chứa `F-004/AC-xx` và xanh · ca biên có test · cổng xanh · blueprint tick có bằng chứng.

## 12. Truy vết

| AC    | Test (tên hoặc chú thích chứa `F-004/AC-xx`)               |
| ----- | ---------------------------------------------------------- |
| AC-01 | `tests/posts/service.test.ts`                              |
| AC-02 | `tests/posts/service.test.ts`, `e2e/posts.spec.ts`         |
| AC-03 | `tests/posts/service.test.ts`                              |
| AC-04 | `tests/posts/service.test.ts`                              |
| AC-05 | `tests/posts/service.test.ts`, `tests/jobs/runner.test.ts` |
| AC-06 | `tests/posts/service.test.ts`                              |
| AC-07 | `tests/posts/service.test.ts`, `tests/jobs/runner.test.ts` |
| AC-08 | `tests/posts/service.test.ts`, `tests/jobs/runner.test.ts` |
| AC-09 | `tests/posts/service.test.ts`                              |

- Task: đợt 1 (đăng bài), chuẩn hoá spec T-560 · Kiểm: `npx vitest run tests/config/specs.test.ts`.

## Thay đổi

| Phiên bản | Ngày       | Gì                                           | Vì sao                            | Duyệt |
| --------- | ---------- | -------------------------------------------- | --------------------------------- | ----- |
| 1         | 2026-11-22 | tạo (dạng rút gọn)                           | đợt 1                             | —     |
| 2         | 2026-11-24 | viết lại theo mẫu khung, AC có ID, theo code | WF-SDD-001..003, PM-SPEC-001..020 | D-032 |
