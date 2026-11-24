---
status: approved
approved_by: phiên chính (tự duyệt, ADR-0008, D-032)
approved_at: 2026-11-24
feature: F-003
requirements: [R-004]
---

# SPEC F-003 — Hộp thư hợp nhất

Trạng thái: Approved for implementation

| Trường       | Giá trị                                                          |
| ------------ | ---------------------------------------------------------------- |
| ID tính năng | F-003 (yêu cầu gốc: R-004)                                       |
| Phiên bản    | 2 — thay đổi: xem cuối file                                      |
| Chủ spec     | phiên chính · Duyệt bởi phiên chính (D-032) ngày 2026-11-24      |
| Hồ sơ/quy mô | web-app / M                                                      |
| Quy ước ID   | `AC-xx` là ID scenario; test ghi `F-003/AC-xx` (xem `README.md`) |

## 1. User story

Là thành viên workspace, tôi muốn thấy tin nhắn, bình luận, đánh giá và lượt nhắc từ mọi trang đã kết nối ở một chỗ, lọc được và đánh dấu đã xử lý, để không bỏ sót khách và không trả lời trùng.

## 2. Tiêu chí chấp nhận

### AC-01 — Đồng bộ nhập tin mới

- Given tài khoản mạng xã hội đã kết nối
- When thành viên bấm Đồng bộ (hoặc job nền chạy)
- Then server giải mã khoá, hỏi mọi loại hộp thư nhà cung cấp hỗ trợ, nhập mục mới (`open`, `received_at` UTC) vào đúng workspace; nhà cung cấp đọc được hội thoại thì DM đi đường hội thoại + tin nhắn

### AC-02 — Đồng bộ lặp không tạo bản trùng

- Given mục đã nhập (có thể đã đánh dấu xử lý)
- When đồng bộ chạy lại, hoặc hai lượt đồng bộ cùng tài khoản chạy cùng lúc
- Then không có bản trùng (UNIQUE theo tài khoản, loại, id ngoài) và trạng thái đã xử lý không bị ghi đè; cùng id ở loại khác là hai mục

### AC-03 — Đồng bộ định kỳ 5 phút qua hàng đợi nền

- Given worker chạy (`RUN_WORKERS=true`)
- When đến lịch `*/5 * * * *`
- Then mỗi tài khoản thành một job riêng có `singletonKey` (không xếp trùng); payload chỉ có `workspaceId` + `accountId`, sai thì bị từ chối

### AC-04 — Lọc và phân trang chỉ trong workspace của mình

- Given hộp thư có nhiều mục
- When lọc theo loại (`dm`, `comment`, `review`, `mention`) hoặc trạng thái (`open`, `handled`), và lật trang
- Then chỉ thấy mục khớp thuộc workspace; mới nhất trước; cursor keyset không sót, không lặp kể cả trùng giờ; `limit` kẹp vào 1..100

### AC-05 — Đánh dấu đã xử lý có dấu vết người thao tác

- Given một mục thuộc workspace
- When thành viên đánh dấu `handled` rồi mở lại `open`
- Then trạng thái đổi; `handled_by` ghi người đánh dấu và xoá khi mở lại

### AC-06 — Webhook ký đúng nhập tin đúng một lần

- Given kết nối SocialAPI đã đặt secret webhook
- When nhà cung cấp gửi sự kiện hộp thư có chữ ký HMAC-SHA256 đúng của `<timestamp>.<thân thô>`, kể cả gửi lại cùng sự kiện
- Then trả 200, mục vào đúng workspace/tài khoản đúng một lần; mục đã xử lý không bị mở lại vì tin cũ; sự kiện không thuộc hộp thư hoặc tài khoản lạ thì 200 bỏ qua

### AC-07 — Webhook xác thực sai bị từ chối như nhau (ca lỗi)

- Given chữ ký sai/thiếu, timestamp lệch quá 5 phút, kết nối không tồn tại, chưa bật webhook, hoặc khác nhà cung cấp
- When gửi webhook
- Then cùng một phản hồi 401 `unauthorized`, không ghi gì; so sánh chữ ký hằng thời gian; đổi một byte thân là sai chữ ký

### AC-08 — Webhook thân quá lớn hoặc hỏng (ca lỗi)

- Given thân > 256 KiB, hoặc chữ ký đúng nhưng JSON hỏng/thiếu trường/thời gian sai
- When gửi webhook
- Then 413 trước khi chạm CSDL; 400 cho thân hỏng; không ghi gì

### AC-09 — Người ngoài và ID lạ bị chặn (ca lỗi)

- Given người không thuộc workspace, hoặc ID tài khoản/mục của workspace khác hay không phải UUID
- When đồng bộ, xem hoặc đổi trạng thái
- Then người ngoài bị Forbidden; ID không thuộc workspace là NotFound; trạng thái lạ là `ValidationError`; không gọi nhà cung cấp

### AC-10 — Lỗi từng loại hay từng mục không chặn phần còn lại (ca lỗi)

- Given một loại hộp thư lỗi (mạng, 401, chưa cài đặt) hoặc nhà cung cấp trả mục sai
- When đồng bộ
- Then loại lỗi chỉ ghi mã an toàn (`http.401`, `internal`, `skipped`), không lộ nội dung lỗi; loại khác vẫn nhập; mục sai (id rỗng, ngày không hợp lệ, loại lệch) bị bỏ qua và đếm `rejected`

## 3. Ca biên

| Nhóm                  | Ca cụ thể                                                             | Hành vi mong đợi                                          | AC                  |
| --------------------- | --------------------------------------------------------------------- | --------------------------------------------------------- | ------------------- |
| Rỗng/null             | nội dung rỗng (tin chỉ có ảnh); id rỗng; hộp thư trống                | nhập chuỗi rỗng (không `null`); bỏ qua id rỗng            | AC-01, AC-10        |
| Cực đại/độ dài        | nội dung > 10.000 ký tự ở `inbox_items`; `limit` 9999; thân > 256 KiB | cắt 10.000 ký tự; kẹp 100; 413                            | AC-01, AC-04, AC-08 |
| Trùng lặp/idempotency | webhook giao trùng; đồng bộ lặp; webhook rồi đồng bộ cùng tin         | đúng một mục, một tin                                     | AC-02, AC-06        |
| Song song             | hai lượt đồng bộ cùng tài khoản; job xếp trùng                        | UNIQUE giữ một bản; `singletonKey` chặn job trùng         | AC-02, AC-03        |
| Mất mạng giữa chừng   | một loại hộp thư lỗi mạng giữa lượt đồng bộ                           | ghi mã an toàn, loại khác vẫn nhập; lượt sau nhập tiếp    | AC-10               |
| Thời gian/múi giờ     | timestamp webhook lệch ±5 phút; `received_at` thiếu múi giờ           | ngoài cửa sổ 401; thiếu múi giờ bị bỏ qua; lưu UTC        | AC-07, AC-10        |
| Quyền                 | người ngoài; ID của workspace khác; kết nối B ký cho A                | Forbidden / NotFound / 401                                | AC-07, AC-09        |
| Tiền/đơn vị           | —                                                                     | không áp dụng — hộp thư không xử lý số tiền hay đơn vị đo | —                   |

## 4. Dữ liệu

| Thực thể                    | Trường                                                                         | Kiểu             | Ràng buộc                                                     | Ai đọc/ghi                          |
| --------------------------- | ------------------------------------------------------------------------------ | ---------------- | ------------------------------------------------------------- | ----------------------------------- |
| `inbox_items`               | `kind`, `external_id`, `author`, `text`, `received_at`, `status`, `handled_by` | text/timestamptz | UNIQUE (tài khoản, loại, id ngoài); `kind`, `status` có CHECK | thành viên đọc; đồng bộ/webhook ghi |
| `conversations`, `messages` | id hội thoại, `platform_id`, nội dung nguyên văn                               | text             | UNIQUE theo tài khoản                                         | như trên                            |

- Hạn lưu tin theo workspace (D-010), xoá bởi job `maintenance.purge-expired`.

## 5. Giao diện / API

- Trang `/app/<workspace>/inbox`: nút Đồng bộ, chip lọc loại/trạng thái, phân trang cursor, nút đánh dấu; tham số lọc/cursor bậy không gây lỗi (e2e `inbox.spec.ts`).
- `POST /api/webhooks/socialapi/<connectionId>` — công khai, xác thực bằng chữ ký (danh sách duyệt ở `docs/ARCHITECTURE.md`).

## 6. Lỗi

| Mã lỗi                    | Khi nào                                  | HTTP/exit code                     | Thông điệp cho người dùng | AC           |
| ------------------------- | ---------------------------------------- | ---------------------------------- | ------------------------- | ------------ |
| `unauthorized`            | webhook xác thực sai vì bất kỳ lý do nào | 401                                | — (máy gọi máy)           | AC-07        |
| `too_large`               | thân webhook > 256 KiB                   | 413                                | —                         | AC-08        |
| `invalid`                 | thân webhook hỏng                        | 400                                | —                         | AC-08        |
| `forbidden` / `not_found` | người ngoài / ID lạ                      | `ForbiddenError` / `NotFoundError` | không tìm thấy            | AC-09        |
| `validation`              | cursor hỏng, trạng thái lạ               | `ValidationError`                  | thông điệp cụ thể         | AC-04, AC-09 |

## 7. Yêu cầu phi chức năng của tính năng

| Thuộc tính | Ngưỡng                                              | Nguồn       | Cách đo                                                                    |
| ---------- | --------------------------------------------------- | ----------- | -------------------------------------------------------------------------- |
| Tin cậy    | 0 bản trùng khi đồng bộ/webhook lặp                 | R-004       | `tests/inbox`, `e2e/inbox.spec.ts`                                         |
| Bảo mật    | webhook chỉ nhận khi chữ ký và cửa sổ 5 phút hợp lệ | ASVS 5.0 L2 | `tests/inbox/webhook.test.ts`, `tests/providers/socialapi-webhook.test.ts` |

## 8. Hành vi AI

- Không dùng model ở tính năng này (nội dung tin là dữ liệu không tin cậy, chỉ lưu và hiển thị đã escape).

## 9. Đo lường

- Log kết quả đồng bộ (`inserted`, `skipped`, `failed` theo mã); chưa có chỉ số sản phẩm riêng.

## 10. Câu hỏi mở

- [x] Spec cũ ghi lọc theo tài khoản và từ khoá; code lọc theo loại và trạng thái, tìm theo từ khoá nằm ở trang Tìm kiếm riêng. — [không chặn] — Đã quyết: D-032 (phiên chính, 2026-11-24) — spec theo code (AC-04); lọc theo tài khoản để backlog nếu người dùng cần.
- [x] Spec cũ không nói số phận mục đã xử lý khi tin cũ đến lại. — [không chặn] — Đã quyết: D-032 (phiên chính, 2026-11-24) — theo code: tin cũ không mở lại mục, tin mới hơn qua webhook mở lại (AC-06).

## 11. DoR / DoD

- DoR: spec Approved · 0 câu hỏi chặn · phụ thuộc rõ · đủ nhỏ cho một PR · mỗi task có Gate.
- DoD: mọi AC có test chứa `F-003/AC-xx` và xanh · ca biên có test · cổng xanh · blueprint tick có bằng chứng.

## 12. Truy vết

| AC    | Test (tên hoặc chú thích chứa `F-003/AC-xx`)                               |
| ----- | -------------------------------------------------------------------------- |
| AC-01 | `tests/inbox/service.test.ts`                                              |
| AC-02 | `tests/inbox/service.test.ts`, `tests/inbox/webhook.test.ts`               |
| AC-03 | `tests/jobs/runner.test.ts`                                                |
| AC-04 | `tests/inbox/service.test.ts`                                              |
| AC-05 | `tests/inbox/service.test.ts`                                              |
| AC-06 | `tests/inbox/webhook.test.ts`, `e2e/webhook.spec.ts`                       |
| AC-07 | `tests/inbox/webhook.test.ts`, `tests/providers/socialapi-webhook.test.ts` |
| AC-08 | `tests/inbox/webhook.test.ts`                                              |
| AC-09 | `tests/inbox/service.test.ts`                                              |
| AC-10 | `tests/inbox/service.test.ts`                                              |

- Task: đợt 1–2 (hộp thư, webhook), chuẩn hoá spec T-560 · Kiểm: `npx vitest run tests/config/specs.test.ts`.

## Thay đổi

| Phiên bản | Ngày       | Gì                                           | Vì sao                            | Duyệt |
| --------- | ---------- | -------------------------------------------- | --------------------------------- | ----- |
| 1         | 2026-11-22 | tạo (dạng rút gọn)                           | đợt 1–2                           | —     |
| 2         | 2026-11-24 | viết lại theo mẫu khung, AC có ID, theo code | WF-SDD-001..003, PM-SPEC-001..020 | D-032 |
