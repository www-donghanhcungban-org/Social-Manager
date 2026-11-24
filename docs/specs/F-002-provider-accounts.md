---
status: approved
approved_by: phiên chính (tự duyệt, ADR-0008, D-032)
approved_at: 2026-11-24
feature: F-002
requirements: [R-003]
---

# SPEC F-002 — Kết nối nhà cung cấp và tài khoản mạng xã hội

Trạng thái: Approved for implementation

| Trường       | Giá trị                                                          |
| ------------ | ---------------------------------------------------------------- |
| ID tính năng | F-002 (yêu cầu gốc: R-003)                                       |
| Phiên bản    | 2 — thay đổi: xem cuối file                                      |
| Chủ spec     | phiên chính · Duyệt bởi phiên chính (D-032) ngày 2026-11-24      |
| Hồ sơ/quy mô | web-app / M                                                      |
| Quy ước ID   | `AC-xx` là ID scenario; test ghi `F-002/AC-xx` (xem `README.md`) |

## 1. User story

Là owner hoặc admin của workspace, tôi muốn dán khoá của nhà cung cấp (SocialAPI hoặc demo) và thêm các trang mạng xã hội của mình, để hộp thư và đăng bài chạy được mà khoá không bao giờ hiện lại hay lọt vào log.

## 2. Tiêu chí chấp nhận

### AC-01 — Khoá nhà cung cấp mã hoá khi lưu

- Given owner/admin chọn nhà cung cấp đã đăng ký, nhập nhãn và khoá
- When lưu kết nối
- Then khoá lưu bằng AES-256-GCM (tiền tố `v1:`, IV ngẫu nhiên, khoá chủ `APP_SECRET_KEY`); giá trị trả về và cột DB không chứa bản rõ

### AC-02 — Khoá không bao giờ hiển thị lại

- Given workspace có kết nối
- When thành viên bất kỳ xem danh sách kết nối
- Then chỉ thấy `id`, `provider`, `label`, `webhookEnabled`, `createdAt`, `workspaceId` — không có khoá hay bản mã; không thấy kết nối của workspace khác

### AC-03 — Chỉ owner/admin quản lý kết nối và tài khoản (ca lỗi)

- Given member hoặc người ngoài workspace
- When tạo/xoá kết nối hoặc thêm/xoá tài khoản mạng xã hội
- Then bị Forbidden, DB không đổi; người ngoài xem danh sách cũng bị Forbidden

### AC-04 — Đầu vào kết nối sai bị từ chối rõ ràng (ca lỗi)

- Given nhà cung cấp chưa đăng ký, nhãn rỗng, khoá rỗng/chỉ khoảng trắng, hoặc nhãn trùng sau chuẩn hoá NFC
- When lưu kết nối (tuần tự hoặc hai lần cùng lúc)
- Then `ValidationError` cho đầu vào rỗng/sai; `ConflictError duplicate_label` cho nhãn trùng trong cùng workspace (workspace khác được trùng); chỉ một bản ghi được tạo

### AC-05 — Thêm tài khoản mạng xã hội vào đúng workspace

- Given kết nối thuộc workspace W
- When owner/admin thêm tài khoản (nền tảng, id ngoài, tên hiển thị)
- Then tài khoản gắn kết nối đó, dạng xem không có khoá; id ngoài/tên rỗng hoặc dài hơn 200 ký tự bị từ chối (chuẩn hoá NFC, cắt khoảng trắng); kết nối của workspace khác hoặc id lạ là NotFound; trùng (kết nối, nền tảng, id ngoài) là `ConflictError duplicate_account`

### AC-06 — Khả năng không hỗ trợ báo lỗi có mã, không im lặng (ca lỗi)

- Given nền tảng hoặc khả năng mà nhà cung cấp không khai hỗ trợ (ví dụ tài khoản TikTok, hay đăng bài lên Telegram qua SocialAPI)
- When thêm tài khoản nền tảng đó hoặc gọi hành động đó
- Then `ValidationError` khi thêm tài khoản; `UnsupportedError` có nền tảng và khả năng trước khi gọi mạng; khai hỗ trợ mà thiếu cài đặt là `not_implemented`, không trả mảng rỗng giả

### AC-07 — Phản hồi nhà cung cấp được kiểm và 429 tôn trọng Retry-After

- Given nhà cung cấp trả 200 sai hình dạng, hoặc 429
- When client SocialAPI gọi
- Then sai hình dạng là `client.invalid_response`; 429 có `Retry-After` hợp lệ thì chờ đúng số giây (cắt theo trần) rồi thử lại, dừng sau `maxRetries`; không có `Retry-After` thì không thử lại

### AC-08 — Lỗi mạng và hết giờ không lộ khoá (ca lỗi)

- Given mạng đứt hoặc nhà cung cấp treo
- When client gọi
- Then báo `client.network` hoặc `client.timeout`; thông điệp lỗi và log không chứa khoá

### AC-09 — Bản mã hỏng không trả rác (ca lỗi)

- Given bản mã trong DB bị sửa hoặc khoá chủ sai
- When server giải mã để gọi nhà cung cấp
- Then ném lỗi, không trả chuỗi rác; kết nối của workspace khác không giải mã được (NotFound)

### AC-10 — Secret webhook được đối xử như khoá

- Given owner/admin của đúng workspace
- When đặt secret webhook 16–256 ký tự không khoảng trắng, hoặc xoá bằng `null`
- Then lưu bản mã, chỉ trả `webhookEnabled`; secret ngắn/dài/có khoảng trắng bị từ chối; member, người ngoài, workspace khác không đặt được

## 3. Ca biên

| Nhóm                  | Ca cụ thể                                                                   | Hành vi mong đợi                                             | AC                  |
| --------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------- |
| Rỗng/null             | khoá rỗng/khoảng trắng; nhãn rỗng; `data: null` từ nhà cung cấp             | `ValidationError` trước khi gọi mạng; `null` thành mảng rỗng | AC-04, AC-07        |
| Cực đại/độ dài        | `Retry-After` quá lớn; secret webhook > 256 ký tự; id ngoài/tên > 200 ký tự | cắt theo trần, không treo; từ chối secret và tên quá dài     | AC-05, AC-07, AC-10 |
| Trùng lặp/idempotency | nhãn trùng sau NFC; tài khoản trùng                                         | `duplicate_label` / `duplicate_account`, không ghi đè        | AC-04, AC-05        |
| Song song             | hai yêu cầu tạo cùng nhãn cùng lúc                                          | đúng một bản ghi, yêu cầu kia nhận `duplicate_label`         | AC-04               |
| Mất mạng giữa chừng   | đứt kết nối; fetch treo                                                     | `client.network` / `client.timeout`, không lộ khoá           | AC-08               |
| Thời gian/múi giờ     | `Retry-After` dạng ngày, âm, không phải số                                  | không thử lại (chỉ nhận số giây)                             | AC-07               |
| Quyền                 | member / người ngoài / owner workspace khác                                 | Forbidden khi quản lý; NotFound theo ID của workspace khác   | AC-03, AC-05        |
| Tiền/đơn vị           | —                                                                           | không áp dụng — tính năng không có số tiền hay đơn vị đo     | —                   |

## 4. Dữ liệu

| Thực thể               | Trường                                    | Kiểu | Ràng buộc                                   | Ai đọc/ghi                      |
| ---------------------- | ----------------------------------------- | ---- | ------------------------------------------- | ------------------------------- |
| `provider_connections` | `credentials_enc`, `webhook_secret_enc`   | text | bản mã `v1:`; bắt buộc có `credentials_enc` | chỉ dịch vụ ở server            |
| `provider_connections` | `provider`, `label`                       | text | duy nhất (workspace, provider, label)       | thành viên đọc; owner/admin ghi |
| `social_accounts`      | `platform`, `external_id`, `display_name` | text | duy nhất (kết nối, nền tảng, id ngoài)      | thành viên đọc; owner/admin ghi |

## 5. Giao diện / API

- Trang `/app/<workspace>/connections` (Server Action, POST cùng nguồn): thêm kết nối, thêm tài khoản, đặt secret webhook, xoá. Không có API công khai.
- Ô khoá là `password`, không điền lại sau khi lưu; nhãn trùng báo lỗi rõ (e2e `connections.spec.ts`).

## 6. Lỗi

| Mã lỗi                           | Khi nào                                 | HTTP/exit code     | Thông điệp cho người dùng              | AC           |
| -------------------------------- | --------------------------------------- | ------------------ | -------------------------------------- | ------------ |
| `forbidden`                      | member/người ngoài quản lý kết nối      | `ForbiddenError`   | "Bạn không có quyền…"                  | AC-03        |
| `validation`                     | đầu vào rỗng/sai, nền tảng không hỗ trợ | `ValidationError`  | thông điệp cụ thể của trường           | AC-04, AC-06 |
| `conflict/duplicate_label`       | nhãn trùng                              | `ConflictError`    | "Đã có kết nối cùng nguồn và nhãn này" | AC-04        |
| `unsupported`, `not_implemented` | khả năng không hỗ trợ/chưa cài          | `UnsupportedError` | báo rõ nền tảng và khả năng            | AC-06        |
| `client.*`, `http.<status>`      | lỗi nhà cung cấp/mạng                   | mã ngắn an toàn    | không chứa nội dung phía nhà cung cấp  | AC-07, AC-08 |

## 7. Yêu cầu phi chức năng của tính năng

| Thuộc tính | Ngưỡng                                      | Nguồn                  | Cách đo                                                               |
| ---------- | ------------------------------------------- | ---------------------- | --------------------------------------------------------------------- |
| Bảo mật    | 0 khoá rõ trong DB, phản hồi, log           | R-003, ASVS 5.0 L2     | `tests/connections`, `tests/security/secret-box.test.ts`, `tests/log` |
| Tin cậy    | mỗi lời gọi có timeout; 429 thử lại hữu hạn | `docs/THREAT-MODEL.md` | `tests/providers/socialapi/client.test.ts`                            |

## 8. Hành vi AI

- Không dùng model.

## 9. Đo lường

- Audit `connection.created`, `connection.removed`, `connection.webhook_secret_changed` (không chứa khoá); chưa có chỉ số sản phẩm riêng.

## 10. Câu hỏi mở

- [x] Spec cũ ghi "nhà cung cấp trả JSON sai schema" mà không nêu mã; code dùng `client.invalid_response` và mã `http.<status>`. — [không chặn] — Đã quyết: D-032 (phiên chính, 2026-11-24) — spec theo code (AC-07, AC-08).
- [x] Secret webhook (thêm ở đợt 2) chưa có trong spec cũ. — [không chặn] — Đã quyết: D-032 (phiên chính, 2026-11-24) — đưa vào AC-10, cùng mức bảo vệ với khoá theo R-003.

## 11. DoR / DoD

- DoR: spec Approved · 0 câu hỏi chặn · phụ thuộc rõ · đủ nhỏ cho một PR · mỗi task có Gate.
- DoD: mọi AC có test chứa `F-002/AC-xx` và xanh · ca biên có test · cổng xanh · blueprint tick có bằng chứng.

## 12. Truy vết

| AC    | Test (tên hoặc chú thích chứa `F-002/AC-xx`)                                    |
| ----- | ------------------------------------------------------------------------------- |
| AC-01 | `tests/connections/service.test.ts`, `tests/security/secret-box.test.ts`        |
| AC-02 | `tests/connections/service.test.ts`, `e2e/connections.spec.ts`                  |
| AC-03 | `tests/connections/service.test.ts`, `tests/accounts/service.test.ts`           |
| AC-04 | `tests/connections/service.test.ts`, `tests/providers/socialapi/client.test.ts` |
| AC-05 | `tests/accounts/service.test.ts`                                                |
| AC-06 | `tests/accounts/service.test.ts`, `tests/providers/actions.test.ts`             |
| AC-07 | `tests/providers/socialapi/client.test.ts`                                      |
| AC-08 | `tests/providers/socialapi/client.test.ts`                                      |
| AC-09 | `tests/connections/service.test.ts`, `tests/security/secret-box.test.ts`        |
| AC-10 | `tests/inbox/webhook.test.ts`                                                   |

- Task: đợt 1 (kết nối, tài khoản), đợt 2 (webhook), chuẩn hoá spec T-560 · Kiểm: `npx vitest run tests/config/specs.test.ts`.

## Thay đổi

| Phiên bản | Ngày       | Gì                                           | Vì sao                            | Duyệt |
| --------- | ---------- | -------------------------------------------- | --------------------------------- | ----- |
| 1         | 2026-11-22 | tạo (dạng rút gọn)                           | đợt 1                             | —     |
| 2         | 2026-11-24 | viết lại theo mẫu khung, AC có ID, theo code | WF-SDD-001..003, PM-SPEC-001..020 | D-032 |
