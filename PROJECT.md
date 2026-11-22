# PROJECT.md — Social Manager

> Đặc tả dự án: nguồn sự thật về _cái gì cần xây_. Kế hoạch gốc: `docs/work/2026-11-22-social-manager-plan/working.md`; kế hoạch thi hành: `docs/autopilot/PLAN.md`; quyết định kiến trúc: `docs/adr/`; mô hình đe doạ: `docs/THREAT-MODEL.md`.

## 0. Loại dự án & Hồ sơ

- Loại dự án: web (ứng dụng tự host, nhiều người dùng, có server và hàng đợi nền).
- Hồ sơ áp dụng: `web-app` · quy mô `M` · không dùng gói ngành.
- Cổng chất lượng: `format_check → lint (--max-warnings 0) → typecheck → test`; cổng đầy đủ thêm `build` và Playwright (xem `xt.yaml`).

## 1. Vấn đề & Người dùng

- Vấn đề: người/nhóm vận hành nhiều trang mạng xã hội phải nhảy giữa nhiều ứng dụng để trả lời tin nhắn, đăng bài và theo dõi kết quả; công cụ sẵn có hoặc chạy một máy, một người, hoặc buộc đưa khoá và dữ liệu khách hàng cho bên thứ ba.
- Người dùng mục tiêu: chủ cửa hàng nhỏ và nhóm marketing 2–10 người, có người biết chạy Docker Compose, muốn giữ dữ liệu và khoá của mình.
- Bằng chứng nhu cầu: phần mềm tham chiếu `qthupro/socials-manager` (MIT) có người dùng nhưng chỉ chạy Windows, một người, bot dừng khi tắt máy, khoá lưu văn bản thường (`working.md` §2).
- Đối thủ & điểm khác biệt: khác biệt là tự host + nhiều người dùng có phân quyền + nguồn dữ liệu cắm được nhiều nhà cung cấp (không khoá vào một dịch vụ).

## 2. Phạm vi MVP (MoSCoW)

- Must have:
  - Đăng ký, đăng nhập, workspace nhiều thành viên với vai trò owner/admin/member (tiêu chí: người ngoài workspace không thấy được gì — `tests/auth/idor.test.ts`).
  - Kết nối nhà cung cấp, thêm tài khoản mạng xã hội; khoá mã hoá khi lưu, không hiển thị lại.
  - Hộp thư hợp nhất: đồng bộ, lọc, đánh dấu đã xử lý.
  - Đăng bài ngay và hẹn giờ, chạy bằng hàng đợi nền, không đăng trùng.
  - Triển khai bằng Docker Compose.
- Should have: webhook nhận tin theo thời gian thực; trả lời từ hộp thư; nhật ký kiểm toán.
- Could have: tự động trả lời bằng AI có chế độ duyệt nháp, thống kê, CRM nhẹ, PWA, i18n vi/en.
- Won't have (lúc này): bản desktop, duyệt bài nhiều cấp, gọi thẳng API từng nền tảng.

## 3. Yêu cầu phi chức năng

- Tốc độ mục tiêu: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 trên trang chính (chưa đo — xem `docs/autopilot/PLAN.md`).
- Bảo mật: kiểm quyền ở server, Argon2id, khoá theo tài khoản, CSP nonce, kiểm CSRF, khoá nhà cung cấp mã hoá AES-256-GCM (chi tiết `docs/THREAT-MODEL.md`).
- Accessibility: WCAG 2.2 AA; cặp màu kiểm bằng `xt.py contrast` (28 cặp, 0 đỏ).
- Mobile-first & trình duyệt: bản hiện đại của Chrome, Firefox, Safari, Edge; bố cục co giãn theo chiều rộng.
- Theme: token màu hai chế độ trong `app/globals.css`.

## 4. Tech stack

Xác minh ngày 2026-11-22 (chi tiết và lý do: `docs/adr/0001-stack.md`).

- Frontend/Backend: Next.js 16.4.6 (App Router, Server Actions) · React 19.3.1 · TypeScript strict · Tailwind 4.
- CSDL: PostgreSQL 16 + Drizzle ORM 0.45.4 (migration có đường lùi) · pg 8.23.1.
- Hàng đợi: pg-boss 12.39.0 (trên Postgres, không cần Redis).
- Đăng nhập: Better Auth 1.7.27 · băm mật khẩu Argon2id bằng hash-wasm 4.13.0 (D-007).
- Kiểm dữ liệu: Zod 4.6.7. Test: Vitest 4, Playwright 1.65, PGlite cho test CSDL.
- Triển khai: Docker (tầng cuối chạy không root) + Compose.

## 5. Thiết kế dữ liệu

Bảng chính (định nghĩa ở `src/db/schema.ts`, `src/db/auth-schema.ts`; migration ở `drizzle/`): `workspaces`, `members`, `provider_connections`, `social_accounts`, `inbox_items`, `posts`, `login_throttle`, và bốn bảng của Better Auth (`user`, `session`, `account`, `verification`). Mọi thời điểm là `timestamptz`; mọi bảng của workspace có khoá ngoại `ON DELETE CASCADE`; quyền kiểm ở tầng dịch vụ (không dùng RLS).

### Phân loại dữ liệu cá nhân và nhạy cảm (BASE-SEC-013)

Nguyên tắc: chỉ thu cái cần cho chức năng; lớp bí mật không bao giờ trả về giao diện hay ghi vào log; xoá workspace xoá toàn bộ dữ liệu của nó.

<!-- bảng sau được `tests/config/data-classification.test.ts` đối chiếu với migration: mỗi cột phải có thật -->

| Cột                                       | Lớp              | Lý do cần thu                            | Bảo vệ khi lưu                      | Thời hạn lưu                                     |
| ----------------------------------------- | ---------------- | ---------------------------------------- | ----------------------------------- | ------------------------------------------------ |
| `user.email`                              | PII              | định danh đăng nhập                      | hạn chế truy cập ở tầng dịch vụ     | đến khi xoá tài khoản                            |
| `user.name`                               | PII              | hiển thị tên người dùng                  | như trên                            | đến khi xoá tài khoản                            |
| `account.password`                        | bí mật           | xác thực                                 | băm Argon2id, không lưu mật khẩu rõ | đến khi xoá tài khoản                            |
| `session.token`                           | bí mật           | duy trì phiên                            | bản ghi xoá khi đăng xuất/hết hạn   | 7 ngày kể từ lúc tạo, xoá hẳn sau 1 ngày hết hạn |
| `session.ip_address`                      | PII              | phát hiện lạm dụng                       | hạn chế truy cập                    | cùng vòng đời phiên                              |
| `session.user_agent`                      | PII              | phát hiện lạm dụng                       | hạn chế truy cập                    | cùng vòng đời phiên                              |
| `provider_connections.credentials_enc`    | bí mật           | gọi nhà cung cấp thay mặt người dùng     | AES-256-GCM, khoá `APP_SECRET_KEY`  | đến khi xoá kết nối                              |
| `provider_connections.webhook_secret_enc` | bí mật           | xác minh chữ ký webhook của nhà cung cấp | AES-256-GCM, khoá `APP_SECRET_KEY`  | đến khi xoá kết nối hoặc gỡ secret               |
| `social_accounts.display_name`            | PII              | hiển thị trang đã kết nối                | hạn chế truy cập theo workspace     | đến khi xoá tài khoản mạng xã hội                |
| `social_accounts.external_id`             | định danh        | ánh xạ sang nhà cung cấp                 | như trên                            | như trên                                         |
| `inbox_items.author`                      | PII (bên thứ ba) | hiển thị người gửi tin                   | hạn chế truy cập theo workspace     | 365 ngày (tính từ `received_at`)                 |
| `inbox_items.text`                        | PII (bên thứ ba) | nội dung cần trả lời                     | như trên                            | 365 ngày (tính từ `received_at`)                 |
| `members.user_id`                         | định danh        | quyền thành viên                         | hạn chế truy cập                    | đến khi gỡ thành viên                            |
| `login_throttle.key_hash`                 | định danh        | giới hạn đăng nhập theo tài khoản        | HMAC của email, không lưu email rõ  | 24 giờ kể từ lần sai gần nhất                    |

- Các cột `account.access_token`, `account.refresh_token`, `account.id_token` do Better Auth tạo cho đăng nhập OAuth; ứng dụng chỉ dùng email + mật khẩu nên luôn rỗng. Nếu sau này bật OAuth phải phân loại là bí mật và mã hoá trước khi lưu.
- Mã hoá at-rest toàn bộ ổ đĩa là việc của người triển khai (volume mã hoá của host); riêng khoá API được mã hoá ở tầng ứng dụng.
- **Thực thi:** job `maintenance.purge-expired` (`src/retention/service.ts`, chạy 03:17 UTC hằng ngày, xoá theo lô) xoá tin quá 365 ngày, phiên và mã xác minh hết hạn quá 1 ngày, bộ đếm đăng nhập cũ hơn 24 giờ. Chỉ chạy khi `RUN_WORKERS=true`. Chưa thực thi: xoá dữ liệu cá nhân theo yêu cầu của từng người (xoá tài khoản) và xoá `social_accounts.display_name`/`members` khi người dùng bị xoá (nợ ghi ở mục 10).

## 6. Kiến trúc & API

- Luồng: trình duyệt → `proxy.ts` (CSP, CSRF, Cache-Control) → trang/Server Action (App Router) → dịch vụ (`src/*/service.ts`, nhận `Db`) → Postgres; worker pg-boss chạy trong cùng tiến trình (`RUN_WORKERS`), qua cổng `JobQueue`.
- Điểm vào: Server Action của từng màn hình (chỉ POST, kèm kiểm Origin), `/api/auth/*` (Better Auth). Không có API công khai khác.
- Logic nhạy cảm ở server: mọi kiểm quyền (`src/auth/access.ts`), mã hoá/giải mã khoá, gọi nhà cung cấp, đăng bài.
- Nhà cung cấp cắm được: `src/providers/` (registry, ma trận năng lực nền tảng × tính năng, adapter demo và SocialAPI); thêm nhà cung cấp = thêm adapter và một dòng đăng ký ở `src/server/container.ts`.

## 7. Luồng người dùng chính

1. Đăng ký → đăng nhập → tạo workspace (trở thành owner).
2. Vào Kết nối: thêm kết nối nhà cung cấp (dán khoá) → thêm tài khoản mạng xã hội.
3. Hộp thư: bấm Đồng bộ (hoặc chờ job 5 phút) → lọc → đánh dấu đã xử lý.
4. Đăng bài: chọn tài khoản, viết nội dung, đăng ngay hoặc hẹn giờ → xem trạng thái ở danh sách.

## 8. Definition of Done (DoD)

- Gate máy xanh (`loop record`), kiểm đủ ca biên của task, không nới cấu hình cổng.
- Mục BLUEPRINT được tick chỉ khi có lệnh kiểm chạy lại được.
- Việc chạm UI: kiểm bằng Playwright trên Postgres thật và `contrast` xanh.

## 9. Lộ trình & Mốc thời gian

Theo `working.md` §4: đợt 0 nền (xong) → đợt 1 kết nối, hộp thư, đăng bài (xong phần lõi) → đợt 2 webhook, trả lời, phân công → đợt 3 AI và tự động hoá có kiểm soát → đợt 4 thống kê và CRM → đợt 5 hoàn thiện (PWA, i18n, audit, phát hành). Chi tiết từng task: `docs/autopilot/PLAN*.md`.

## 10. Rủi ro & Giả định

- Chưa thử SocialAPI bằng khoá thật; hình dạng phản hồi dựa tài liệu, chưa đối chiếu với dịch vụ sống (DEBT trong adapter). Kiểm chứng: chạy với khoá thật ở môi trường thử.
- Chưa có webhook: hộp thư dựa vào đồng bộ định kỳ 5 phút.
- Chưa có chức năng xoá tài khoản/xoá dữ liệu cá nhân theo yêu cầu (quyền xoá của chủ dữ liệu); `members.user_id` chưa có khoá ngoại tới `user.id`.
- Image Docker chưa build được trong môi trường phát triển (không có daemon): cần chạy `docker compose up --build` một lần ở máy có Docker.
- Giả định: người triển khai tự đặt reverse proxy có TLS và ghi đè header IP client.
