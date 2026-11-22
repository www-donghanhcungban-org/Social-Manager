# THREAT-MODEL — Social Manager · phiên bản 1 · 2026-11-22

> Chủ: chủ dự án · Duyệt: chưa có người duyệt riêng (phiên chính tự soạn theo ADR-0008 của khung; cần người chịu trách nhiệm bảo mật xem lại trước khi chạy thật) · Phạm vi: web app, CSDL, hàng đợi nền, tích hợp nhà cung cấp mạng xã hội · Ngoài phạm vi: hạ tầng host/reverse proxy của người triển khai, bảo mật phía nhà cung cấp (SocialAPI), AI tự trả lời (chưa xây).

## 1. Tài sản

| ID   | Tài sản                                        | Phân loại | Ảnh hưởng nếu lộ / sửa / mất                                                   |
| ---- | ---------------------------------------------- | --------- | ------------------------------------------------------------------------------ |
| A-01 | Khoá API nhà cung cấp (`provider_connections`) | bí mật    | Kẻ khác đăng bài, đọc tin nhắn khách hàng bằng danh nghĩa trang của người dùng |
| A-02 | Mật khẩu và phiên đăng nhập                    | bí mật    | Chiếm tài khoản, truy cập mọi workspace của nạn nhân                           |
| A-03 | Hộp thư (tin nhắn, bình luận của khách hàng)   | nhạy cảm  | Lộ dữ liệu cá nhân của bên thứ ba, rủi ro pháp lý                              |
| A-04 | Bài đăng và lịch đăng                          | toàn vẹn  | Đăng sai nội dung lên trang thật, mất uy tín                                   |
| A-05 | `APP_SECRET_KEY`, `BETTER_AUTH_SECRET`         | bí mật    | Giải mã mọi khoá API đã lưu, giả mạo phiên                                     |
| A-06 | Quyền thành viên workspace (`members`)         | toàn vẹn  | Leo quyền, xem/sửa dữ liệu workspace khác                                      |

## 2. Thành phần, ranh giới tin cậy, luồng dữ liệu

```text
[Trình duyệt] --(1) HTTPS--> [proxy.ts + Next.js app] --(2)--> [PostgreSQL]
                                   |--(3) HTTPS--> [Nhà cung cấp: SocialAPI / demo]
                                   |--(4)--> [pg-boss worker (cùng tiến trình)] --(2)--> [PostgreSQL]
Ranh giới tin cậy: TB1 = Internet ↔ app · TB2 = app ↔ CSDL · TB3 = app ↔ nhà cung cấp
```

| Luồng | Từ → Đến           | Dữ liệu                                  | Qua ranh giới | Xác thực / mã hoá                                    |
| ----- | ------------------ | ---------------------------------------- | ------------- | ---------------------------------------------------- |
| 1     | Trình duyệt → app  | đăng nhập, form, Server Action           | TB1           | TLS (do reverse proxy), cookie phiên, kiểm Origin    |
| 2     | app → CSDL         | mọi dữ liệu; khoá API đã mã hoá          | TB2           | mạng nội bộ compose, mật khẩu CSDL, truy vấn tham số |
| 3     | app → nhà cung cấp | khoá API, nội dung bài, truy vấn hộp thư | TB3           | chỉ https, khoá giải mã tại lúc dùng, timeout        |
| 4     | worker → CSDL/NCC  | bài đến hạn, đồng bộ hộp thư             | TB2, TB3      | cùng cơ chế luồng 2 và 3                             |

## 3. Kẻ tấn công giả định

| Ai                          | Năng lực                                   | Mục tiêu                                          |
| --------------------------- | ------------------------------------------ | ------------------------------------------------- |
| Người lạ trên Internet      | gửi request tuỳ ý, tự động, dò mật khẩu    | chiếm tài khoản, lấy dữ liệu, làm sập dịch vụ     |
| Thành viên workspace khác   | tài khoản hợp lệ, biết/đoán ID tài nguyên  | xem/sửa dữ liệu của workspace không thuộc về mình |
| Thành viên cấp thấp         | tài khoản `member` trong cùng workspace    | làm việc của admin (xoá kết nối, xem khoá)        |
| Trang web độc hại           | lừa người dùng đang đăng nhập bấm/gửi form | thực hiện hành động thay nạn nhân (CSRF, XSS)     |
| Nhà cung cấp/nội dung ngoài | trả dữ liệu sai hình, nội dung chứa mã     | tiêm script, làm app lỗi, lộ lỗi nội bộ           |

## 4. Mối đe doạ theo luồng (STRIDE)

| ID    | Luồng | STRIDE                   | Mối đe doạ cụ thể                                              | Mức | Biện pháp                                                                                                    | Bằng chứng                                                                                           | Trạng thái |
| ----- | ----- | ------------------------ | -------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------- |
| TM-01 | 1     | S Spoofing               | đánh cắp/đoán phiên                                            | Cao | cookie HttpOnly + SameSite=Lax, `__Host-` + Secure trên https, token ≥ 128 bit, logout xoá phiên             | `tests/auth-integration/auth.test.ts` (BE-AUTH-004)                                                  | đã giảm    |
| TM-02 | 1     | S Spoofing               | dò mật khẩu hàng loạt                                          | Cao | Argon2id, giới hạn theo IP và khoá theo tài khoản (trần 15 phút), phản hồi đồng nhất                         | `tests/auth/password.test.ts`, `tests/auth/throttle.test.ts`, `tests/auth-integration/auth.test.ts`  | đã giảm    |
| TM-03 | 1     | S Spoofing               | lộ tài khoản nào đã đăng ký                                    | TB  | đăng ký trùng email trả cùng phản hồi, đăng nhập sai báo chung, khoá không phân biệt email                   | `tests/auth-integration/auth.test.ts`                                                                | đã giảm    |
| TM-04 | 1     | T Tampering              | CSRF: trang ngoài POST bằng cookie nạn nhân                    | Cao | từ chối cross-site theo `Sec-Fetch-Site`/`Origin`, SameSite=Lax, không GET đổi trạng thái                    | `tests/security/csrf.test.ts`, `e2e/security-headers.spec.ts`                                        | đã giảm    |
| TM-05 | 1     | T Tampering              | XSS đánh cắp phiên/đổi hành động                               | Cao | CSP nonce không `unsafe-inline` cho script, escape mặc định của React, nội dung hộp thư render thuần văn bản | `tests/security/headers.test.ts`, `e2e/security-headers.spec.ts`, `e2e/inbox.spec.ts`                | đã giảm    |
| TM-06 | 1     | T Tampering              | payload sai hình vượt validate phía client                     | Cao | kiểm bằng schema ở server (Zod), từ chối giá trị lạ, chuẩn hoá NFC                                           | `tests/posts/service.test.ts`, `tests/accounts/service.test.ts`                                      | đã giảm    |
| TM-07 | 2     | I Information disclosure | IDOR: dùng ID của workspace khác                               | Cao | mọi truy vấn kèm điều kiện workspace; sai workspace → NotFound, người ngoài → Forbidden                      | `tests/auth/idor.test.ts`                                                                            | đã giảm    |
| TM-08 | 2     | E Elevation of privilege | thành viên cấp thấp làm việc của admin                         | Cao | ma trận quyền kiểm ở server cho từng hành động                                                               | `tests/auth/permissions.test.ts`                                                                     | đã giảm    |
| TM-09 | 2     | I Information disclosure | lộ khoá API qua DB/log/phản hồi                                | Cao | AES-256-GCM, khoá chỉ giải mã lúc gọi nhà cung cấp, không trả về UI, logger che bí mật                       | `tests/security/secret-box.test.ts`, `tests/connections/service.test.ts`, `tests/log/logger.test.ts` | đã giảm    |
| TM-10 | 2     | T Tampering              | SQL injection                                                  | Cao | truy vấn tham số qua Drizzle, không nối chuỗi từ input                                                       | `tests/config/web-hygiene.test.ts` (chưa có quét SAST — xem mục 6)                                   | một phần   |
| TM-11 | 3     | I Information disclosure | khoá API gửi qua kênh không mã hoá                             | Cao | `SOCIALAPI_BASE_URL` chỉ nhận https, không có cờ tắt xác minh TLS                                            | `tests/config/deploy.test.ts`                                                                        | đã giảm    |
| TM-12 | 3, 4  | T Tampering              | phản hồi nhà cung cấp sai hình/độc hại                         | TB  | parse và kiểm schema từng phản hồi, lỗi nhà cung cấp quy về mã chung không lộ chi tiết                       | `tests/providers/`, `tests/http/errors.test.ts`                                                      | đã giảm    |
| TM-13 | 4     | T Tampering              | đăng trùng bài khi retry/worker chạy song song                 | Cao | khoá idempotency, nhận bài bằng `SKIP LOCKED`, bài kẹt → `failed` (không tự đăng lại)                        | `tests/posts/service.test.ts`, `tests/jobs/runner.test.ts`                                           | đã giảm    |
| TM-14 | 1     | D Denial of service      | spam đăng nhập/endpoint, truy vấn nặng                         | TB  | giới hạn tần suất theo IP, timeout DB và nhà cung cấp, phân trang keyset                                     | `tests/auth-integration/auth.test.ts`, `tests/db/client.test.ts`                                     | một phần   |
| TM-15 | 1     | R Repudiation            | không biết ai đăng/xử lý tin                                   | TB  | ghi `created_by` cho bài, `handled_by` cho tin                                                               | `tests/posts/service.test.ts`, `tests/inbox/service.test.ts`                                         | một phần   |
| TM-16 | 1, 2  | D Denial of service      | khoá tài khoản cố ý (kẻ khác dò sai mật khẩu để khoá nạn nhân) | TB  | trần khoá 15 phút, tự đặt lại sau 24 giờ; vẫn còn giới hạn theo IP                                           | `tests/auth/throttle.test.ts`                                                                        | chấp nhận  |
| TM-17 | —     | I Information disclosure | bí mật nằm trong repo/image                                    | Cao | `.dockerignore` loại `.env`/khoá, không giá trị mặc định, quét bí mật trên CI                                | `tests/config/deploy.test.ts`, `.github/workflows/secret-scan.yml`                                   | một phần   |

## 5. Giả định và chấp nhận rủi ro

- Reverse proxy do người triển khai đặt và chịu trách nhiệm TLS, ghi đè header IP client — kiểm: README mục triển khai, `CLIENT_IP_HEADER`.
- CSDL chỉ nối được từ mạng nội bộ compose — kiểm: `tests/config/deploy.test.ts`.
- Chấp nhận TM-16: kẻ tấn công có thể khoá một email tối đa 15 phút mỗi đợt; đánh đổi để dò mật khẩu bị hạn chế mạnh — người chấp nhận: phiên chính (D-007 liên quan) — xem lại khi có xác thực nhiều lớp (MFA).

## 6. Hành động còn mở

| Mối đe doạ | Việc                                                                                                              | Task/PR | Hạn                |
| ---------- | ----------------------------------------------------------------------------------------------------------------- | ------- | ------------------ |
| TM-10      | thêm quét SAST (CodeQL đã có workflow, cần xác nhận bật `js/sql-injection`)                                       | chưa có | trước phát hành    |
| TM-14      | bộ đếm giới hạn tần suất đang ở bộ nhớ tiến trình (DEBT trong `auth.ts`), chuyển sang CSDL khi chạy nhiều bản sao | chưa có | trước khi nhân bản |
| TM-15      | chưa có nhật ký kiểm toán chung cho mọi hành động (xoá kết nối, đổi vai trò)                                      | chưa có | đợt 2              |
| TM-17      | gitleaks/quét lịch sử chưa chạy trong môi trường này (BASE-SEC-002)                                               | chưa có | trước phát hành    |
| (mới)      | webhook từ nhà cung cấp chưa xây; khi xây phải xác minh chữ ký và chống phát lại, rồi thêm vào mô hình này        | chưa có | đợt 2              |
| (mới)      | AI tự trả lời: prompt injection từ nội dung hộp thư, cần mô hình riêng trước khi xây                              | chưa có | đợt 2              |

## Lịch sử

| Phiên bản | Ngày       | Thay đổi     | Lý do                             |
| --------- | ---------- | ------------ | --------------------------------- |
| 1         | 2026-11-22 | bản đầu tiên | MUST BASE-SEC-011, sau đợt 1 xong |
