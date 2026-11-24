# PROJECT.md — X-Workspace

> Đặc tả dự án: nguồn sự thật về _cái gì cần xây_. Kế hoạch: `docs/work/2026-11-22-x-workspace-plan/working.md` (nền Social Manager: `docs/work/2026-11-22-social-manager-plan/working.md`); kế hoạch thi hành: `docs/autopilot/PLAN-xw-1.md` (đợt 0: `docs/autopilot/PLAN.md`); quyết định kiến trúc: `docs/adr/`; mô hình đe doạ: `docs/THREAT-MODEL.md`.

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

Phạm vi MVP đóng băng ở cổng G1; mọi thay đổi sau đó đi qua `SCOPE.md`.

| Mức    | ID    | Tính năng                                                                                  | Spec                                       |
| ------ | ----- | ------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Must   | F-001 | Đăng ký, đăng nhập, workspace nhiều thành viên với vai trò owner/admin/member              | `docs/specs/F-001-workspace-auth.md`       |
| Must   | F-002 | Kết nối nhà cung cấp, thêm tài khoản mạng xã hội; khoá mã hoá khi lưu, không hiển thị lại  | `docs/specs/F-002-provider-accounts.md`    |
| Must   | F-003 | Hộp thư hợp nhất: đồng bộ, lọc, đánh dấu đã xử lý                                          | `docs/specs/F-003-unified-inbox.md`        |
| Must   | F-004 | Đăng bài ngay và hẹn giờ, chạy bằng hàng đợi nền, không đăng trùng                         | `docs/specs/F-004-publish-posts.md`        |
| Must   | F-005 | Triển khai bằng Docker Compose                                                             | `docs/specs/F-005-self-host-deploy.md`     |
| Should | F-006 | Hội thoại, nháp trả lời có phiên bản, yêu cầu gửi đúng một lần (gửi thật tắt mặc định)     | `docs/specs/F-006-conversation-replies.md` |
| Should | F-007 | Nhập tài liệu, dự án và bí danh, liên kết nguồn, tìm kiếm có dấu/không dấu trong workspace | `docs/specs/F-007-knowledge-projects.md`   |
| Should | F-008 | Hỏi đáp AI có trích dẫn qua cổng AI (đồng ý đám mây, ngân sách, che PII, guard)            | `docs/specs/F-008-ai-answers.md`           |
| Should | F-009 | Quyền chủ tài khoản: xuất dữ liệu, xoá tài khoản, cấp/rút đồng ý                           | `docs/specs/F-009-account-rights.md`       |

- Should have: webhook nhận tin theo thời gian thực; trả lời từ hộp thư; nhật ký kiểm toán.
- Could have: tự động trả lời bằng AI có chế độ duyệt nháp, thống kê, CRM nhẹ, PWA, i18n vi/en.
- Won't have (lúc này): bản desktop, duyệt bài nhiều cấp, gọi thẳng API từng nền tảng.

### Yêu cầu (ID ổn định, không tái sử dụng ID đã bỏ)

| ID    | Yêu cầu                                                                                        | Tính năng |
| ----- | ---------------------------------------------------------------------------------------------- | --------- |
| R-001 | Người ngoài workspace không đọc, sửa hay biết sự tồn tại của dữ liệu trong workspace           | F-001     |
| R-002 | Luôn còn ít nhất một owner trong mỗi workspace, kể cả khi thao tác song song                   | F-001     |
| R-003 | Khoá nhà cung cấp mã hoá khi lưu và không hiển thị hay ghi log lại                             | F-002     |
| R-004 | Tin nhắn và bình luận đồng bộ về hộp thư đúng một lần, kể cả khi đồng bộ hay webhook lặp       | F-003     |
| R-005 | Mỗi bài chỉ đăng đúng một lần; trạng thái hiển thị đúng sự thật, không tự đăng lại khi chưa rõ | F-004     |
| R-006 | Tự host được bằng một lệnh Docker Compose, migration lũy đẳng, không chạy bằng root            | F-005     |

## 3. Yêu cầu phi chức năng

Bảng chất lượng theo đặc tính ISO/IEC 25010:2023 (số đo và ngưỡng; nguồn đo ghi ở cột cuối, chưa đo = nêu rõ):

| Đặc tính (25010)       | Số đo và ngưỡng                                                                      | Nguồn đo                                             |
| ---------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Performance efficiency | LCP ≤ 2,5 s · INP ≤ 200 ms · CLS ≤ 0,1 trên trang chính                              | chưa đo (hàng `perf` của `xt.py release-check`)      |
| Reliability            | Không đăng trùng: 0 bài trùng khi chạy lặp/song song; hành động gửi kẹt gỡ ≤ 10 phút | `tests/posts/`, `tests/actions/ledger-stuck.test.ts` |
| Security               | ASVS mức 2; 0 phát hiện bảo mật 🔴/🟠 mở trong sổ audit                              | `docs/ops/AUDIT-STATUS.md`, `docs/THREAT-MODEL.md`   |
| Compatibility          | 4 trình duyệt hiện đại (Chrome, Firefox, Safari, Edge)                               | `e2e/`                                               |
| Usability              | WCAG 2.2 AA: 28 cặp màu, 0 đỏ                                                        | `xt.py contrast` (`contrast-pairs.txt`)              |
| Maintainability        | Độ phủ câu lệnh ≥ ngưỡng ở `xt.yaml`; hiện 92,07%                                    | `npm run test:coverage`                              |

- Tốc độ mục tiêu: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 trên trang chính (chưa đo — xem `docs/autopilot/PLAN.md`).
- Bảo mật: kiểm quyền ở server, Argon2id, khoá theo tài khoản, CSP nonce, kiểm CSRF, khoá nhà cung cấp mã hoá AES-256-GCM (chi tiết `docs/THREAT-MODEL.md`).
- Accessibility: WCAG 2.2 AA; cặp màu kiểm bằng `xt.py contrast` (28 cặp, 0 đỏ).
- Mobile-first & trình duyệt: bản hiện đại của Chrome, Firefox, Safari, Edge; bố cục co giãn theo chiều rộng.
- Theme: token màu hai chế độ trong `app/globals.css`.

### Hiệu năng

Chỉ số chính, mục tiêu số và điều kiện đo (đề xuất của phiên chính theo D-027; chủ dự án chốt lại ở T-542 nếu muốn đổi). Ngân sách và cách báo cáo: `docs/PERF-BUDGET.md`.

| Chỉ số                                 | Mục tiêu                      | Điều kiện đo                                                    | Nơi đo                              |
| -------------------------------------- | ----------------------------- | --------------------------------------------------------------- | ----------------------------------- |
| LCP của trang workspace và hộp thư     | ≤ 2,5 s (trung vị 3 lần chạy) | Lighthouse mobile, mạng 4G giả lập, dữ liệu mẫu ~1.000 tin      | lab (chưa có Lighthouse CI, xem nợ) |
| CLS                                    | ≤ 0,1                         | như trên                                                        | lab                                 |
| INP (proxy lab: TBT)                   | ≤ 200 ms (TBT ≤ 300 ms)       | như trên                                                        | lab                                 |
| JS client gzip (tổng)                  | ≤ 260 kB                      | `next build` Turbopack, `.next/static/chunks`                   | CI: `scripts/check-bundle.mjs`      |
| Độ trễ phản hồi máy chủ của trang động | p95 ≤ 800 ms                  | một Postgres cục bộ, 10 yêu cầu đồng thời, workspace ~1.000 tin | field: `/api/metrics` (histogram)   |

### Dữ liệu & pháp lý (PM-REQ-009)

- **Dữ liệu cá nhân: có.** Email và tên của người dùng; địa chỉ IP/thiết bị trong phiên và audit; tên, mã người dùng và nội dung tin nhắn của khách nhắn tin với workspace (bên thứ ba, không có tài khoản).
- **Dữ liệu nhạy cảm: không chủ động thu** (sức khoẻ, tài chính, trẻ em, sinh trắc). Nội dung tin tự do có thể vô tình chứa số điện thoại, căn cước, địa chỉ, thông tin sức khoẻ hay tài chính của khách: coi là dữ liệu cá nhân, che trước khi gửi AI đám mây (`src/ai/redact.ts`) và câu hỏi thuộc nhóm nhạy cảm chuyển người (`src/ai/guard.ts`).
- **Khung pháp lý áp dụng** (tra ngày 2026-11-24, qua nguồn thứ cấp; **bản chính thức ở Công báo/vbpl.moj.gov.vn chưa đối chiếu**, host này không truy cập được từ phiên làm việc → mọi số Điều dưới đây là "(chưa xác minh với bản gốc)"). Trước khi dùng cho hồ sơ nộp cơ quan: kiểm tra văn bản sửa đổi, hợp nhất và hướng dẫn mới.

  | Văn bản                                                                                                   | Ngày ban hành   | Hiệu lực        | Dùng cho                                                                                                                                                                                                      | URL                                                                                                                               |
  | --------------------------------------------------------------------------------------------------------- | --------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
  | Luật Bảo vệ dữ liệu cá nhân **91/2025/QH15**                                                              | 26/06/2025      | 01/01/2026      | nền tảng; Đ.20 chuyển dữ liệu xuyên biên giới, Đ.21–22 đánh giá tác động, Đ.23 thông báo vi phạm (72 giờ khi vi phạm có thể gây hại)                                                                          | https://hethongphapluat.com/luat-bao-ve-du-lieu-ca-nhan-2025/khoan-1-dieu-3                                                       |
  | Nghị định **356/2025/NĐ-CP** (thay NĐ 13/2023/NĐ-CP)                                                      | 31/12/2025      | 01/01/2026      | Đ.5 hạn trả lời yêu cầu chủ thể (rút đồng ý/hạn chế/phản đối 15 ngày; xem/chỉnh sửa 10; xoá 20; biện pháp bảo vệ 15); Đ.18 khoản 4 hồ sơ chuyển dữ liệu ra nước ngoài trong 60 ngày; Mẫu 08 thông báo vi phạm | https://luatvietnam.vn/dan-su/nghi-dinh-356-2025-nd-cp-quy-dinh-chi-tiet-luat-bao-ve-du-lieu-ca-nhan-422896-d1.html               |
  | Luật Dữ liệu **60/2024/QH15**                                                                             | 30/11/2024      | 01/07/2025      | nhận diện, chưa phân tích điều khoản                                                                                                                                                                          | https://thuvienphapluat.vn/van-ban/bo-may-hanh-chinh/luat-du-lieu-2024-so-60-2024-qh15-621343.aspx                                |
  | Luật An ninh mạng **116/2025/QH15**                                                                       | 10/12/2025      | 01/07/2026      | nhận diện, chưa phân tích điều khoản lưu/chuyển dữ liệu (chưa xác minh)                                                                                                                                       | https://www.ey.com/content/dam/ey-unified-site/ey-com/vi-vn/technical/tax/documents/ey-vietnam-law-on-cybersecurity-2025-vn-1.pdf |
  | Luật Trí tuệ nhân tạo **134/2025/QH15**                                                                   | (chưa xác minh) | (chưa xác minh) | phần hỏi đáp AI; số hiệu và ngày chưa tra được trong đợt này                                                                                                                                                  | —                                                                                                                                 |
  | GDPR **(EU) 2016/679** (Art. 12(3), 33, 44–46) và Quyết định thi hành (EU) **2021/914** (SCC, 04/06/2021) | —               | —               | **không áp dụng** khi không phục vụ người dùng EU/UK (D-031); ghi để so sánh                                                                                                                                  | https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679                                                         |

  Văn bản tham chiếu mới thấy ở nguồn tư vấn, chưa xác minh: NĐ 330/2026/NĐ-CP về xử phạt vi phạm hành chính (ngày ban hành 19/8/2026) — có thể liên quan mức phạt.

- **Chuẩn bảo mật nhắm tới:** **ASVS 5.0.0 L2** (OWASP Application Security Verification Standard, bản ổn định phát hành 30/05/2025; nguồn https://asvs.owasp.org/, tra 2026-11-24). L2 vì sản phẩm giữ dữ liệu cá nhân và nội dung tin nhắn của bên thứ ba nhưng không xử lý tiền/sinh trắc/y tế (L3). Kết quả đối chiếu theo từng yêu cầu: `docs/ops/AUDIT-STATUS.md`, `docs/THREAT-MODEL.md`.
- **Phạm vi địa lý:** chỉ phục vụ người dùng và khách tại Việt Nam (quyết định D-031); GDPR/UK GDPR, PDPA Singapore/Thái Lan, CCPA không áp dụng. Nếu mở cho người dùng nước khác, các MUST CMP-INTL phải làm lại.
- **Hồ sơ pháp lý:** DPIA `docs/DPIA.md` · luồng ra nước ngoài `docs/privacy/transfers.md` · bên xử lý `docs/privacy/processors.md` và `docs/compliance/vendors.yaml` · nhật ký cập nhật `docs/privacy/CHANGELOG.md` · thông báo vi phạm `docs/ops/runbooks/data-breach.md` · sổ sự cố `docs/ops/incidents/`.
- Gói riêng đã ghép vào `BLUEPRINT.md`: nhóm CMP-PRIV, CMP-RIGHTS, CMP-VN, CMP-AI.
- Kiểm kê chi tiết, quyền chủ thể và đồng ý: mục 5.

## 4. Tech stack

Xác minh ngày 2026-11-22 (chi tiết và lý do: `docs/adr/0001-stack.md`).

- Frontend/Backend: Next.js 16.4.6 (App Router, Server Actions) · React 19.3.1 · TypeScript strict · Tailwind 4.
- CSDL: PostgreSQL 16 + Drizzle ORM 0.45.4 (migration có đường lùi) · pg 8.23.1.
- Hàng đợi: pg-boss 12.39.0 (trên Postgres, không cần Redis).
- Đăng nhập: Better Auth 1.7.27 · băm mật khẩu Argon2id bằng hash-wasm 4.13.0 (D-007).
- Kiểm dữ liệu: Zod 4.6.7. Test: Vitest 5, Playwright 1.65, PGlite cho test CSDL.
- Triển khai: Docker (tầng cuối chạy không root) + Compose.

### Dữ liệu test và môi trường test (QA-DATA-001, QA-INT-001/002)

- **Cấm** đưa dump/export dữ liệu production vào repo, CI, staging hay máy dev; fixture là dữ liệu tổng hợp (email dùng `@example.com`, không SĐT/CCCD/địa chỉ thật). Chính sách chi tiết: `docs/compliance/test-data-policy.md`. Không dùng bản sao ẩn danh hoá dữ liệu thật.
- **Hai tầng CSDL test, cùng chuỗi migration thật** (thư mục `drizzle/`, chạy từ rỗng; không có `schema.sql` dựng tay): (1) test đơn vị/tích hợp chạy trên **PGlite** (Postgres biên dịch WASM, cùng họ 16 — khác biệt về khoá/đồng thời được bù ở tầng 2); (2) job CI `gate` và `e2e` chạy trên **Postgres 16 thật** (service `postgres:16-alpine` ghim digest) — cùng major với production (`docker-compose.yml`: `postgres:16`). Test cần ngữ nghĩa Postgres thật (khoá dòng, đồng thời) viết ở `*.pg.test.ts` và chạy khi có `TEST_DATABASE_URL`.

## 5. Thiết kế dữ liệu

Bảng chính (định nghĩa ở `src/db/schema.ts`, `src/db/auth-schema.ts`; migration ở `drizzle/`): `workspaces`, `members`, `provider_connections`, `social_accounts`, `inbox_items`, `posts`, `login_throttle`, và bốn bảng của Better Auth (`user`, `session`, `account`, `verification`). Mọi thời điểm là `timestamptz`; mọi bảng của workspace có khoá ngoại `ON DELETE CASCADE`; quyền kiểm ở tầng dịch vụ (không dùng RLS).

### Phân loại dữ liệu cá nhân và nhạy cảm (BASE-SEC-013)

Nguyên tắc: chỉ thu cái cần cho chức năng; lớp bí mật không bao giờ trả về giao diện hay ghi vào log; xoá workspace xoá toàn bộ dữ liệu của nó.

<!-- bảng sau được `tests/config/data-classification.test.ts` đối chiếu với migration: mỗi cột phải có thật -->

| Cột                                       | Lớp                          | Lý do cần thu                                              | Bảo vệ khi lưu                             | Thời hạn lưu                                                                    |
| ----------------------------------------- | ---------------------------- | ---------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| `user.email`                              | PII                          | định danh đăng nhập                                        | hạn chế truy cập ở tầng dịch vụ            | đến khi xoá tài khoản                                                           |
| `user.name`                               | PII                          | hiển thị tên người dùng                                    | như trên                                   | đến khi xoá tài khoản                                                           |
| `account.password`                        | bí mật                       | xác thực                                                   | băm Argon2id, không lưu mật khẩu rõ        | đến khi xoá tài khoản                                                           |
| `session.token`                           | bí mật                       | duy trì phiên                                              | bản ghi xoá khi đăng xuất/hết hạn          | 7 ngày kể từ lúc tạo, xoá hẳn sau 1 ngày hết hạn                                |
| `session.ip_address`                      | PII                          | phát hiện lạm dụng                                         | hạn chế truy cập                           | cùng vòng đời phiên                                                             |
| `session.user_agent`                      | PII                          | phát hiện lạm dụng                                         | hạn chế truy cập                           | cùng vòng đời phiên                                                             |
| `audit_events.source_ip`                  | PII                          | audit trail: ai làm ở đâu (CMP-AUDIT-002)                  | chỉ ghi thêm (trigger), hạn chế truy cập   | giữ ≥ 12 tháng, không xoá tự động; xoá chỉ qua job riêng có ghi nhận            |
| `audit_events.user_agent`                 | PII                          | audit trail: ai làm ở đâu (CMP-AUDIT-002)                  | chỉ ghi thêm (trigger), cắt 256 ký tự      | giữ ≥ 12 tháng, không xoá tự động; xoá chỉ qua job riêng có ghi nhận            |
| `audit_events.actor_id`                   | định danh                    | audit trail: ai làm gì                                     | chỉ ghi thêm (trigger)                     | giữ ≥ 12 tháng; sau khi xoá tài khoản chỉ còn mã không gắn tên hay email        |
| `consents.subject_id`                     | định danh                    | chứng minh đồng ý theo từng mục đích (CMP-RIGHTS-001)      | chỉ ghi thêm ở dịch vụ, hạn chế truy cập   | đến khi xoá workspace hoặc tài khoản người cấp                                  |
| `provider_connections.credentials_enc`    | bí mật                       | gọi nhà cung cấp thay mặt người dùng                       | AES-256-GCM, khoá `APP_SECRET_KEY`         | đến khi xoá kết nối                                                             |
| `provider_connections.webhook_secret_enc` | bí mật                       | xác minh chữ ký webhook của nhà cung cấp                   | AES-256-GCM, khoá `APP_SECRET_KEY`         | đến khi xoá kết nối hoặc gỡ secret                                              |
| `social_accounts.display_name`            | PII                          | hiển thị trang đã kết nối                                  | hạn chế truy cập theo workspace            | đến khi xoá tài khoản mạng xã hội                                               |
| `social_accounts.external_id`             | định danh                    | ánh xạ sang nhà cung cấp                                   | như trên                                   | như trên                                                                        |
| `inbox_items.author`                      | PII (bên thứ ba)             | hiển thị người gửi tin                                     | hạn chế truy cập theo workspace            | 365 ngày (tính từ `received_at`)                                                |
| `inbox_items.text`                        | PII (bên thứ ba)             | nội dung cần trả lời                                       | như trên                                   | 365 ngày (tính từ `received_at`)                                                |
| `conversations.participant_id`            | định danh                    | ghép tin về đúng người nhắn                                | hạn chế truy cập theo workspace            | xoá khi hết tin còn hạn (365 ngày)                                              |
| `conversations.participant_name`          | PII (bên thứ ba)             | hiển thị người nhắn                                        | như trên                                   | xoá khi hết tin còn hạn (365 ngày)                                              |
| `messages.author`                         | PII (bên thứ ba)             | hiển thị người gửi từng tin                                | hạn chế truy cập theo workspace            | 365 ngày (tính từ `sent_at`)                                                    |
| `messages.text`                           | PII (bên thứ ba)             | lưu nguyên văn hội thoại để tra cứu                        | như trên                                   | 365 ngày (tính từ `sent_at`)                                                    |
| `evidence_items.external_id`              | định danh                    | trỏ về mục gốc ở nguồn (tin, issue, tài liệu)              | hạn chế truy cập theo workspace            | theo nguồn: tin nhắn cùng hạn `messages` (365 ngày mặc định)                    |
| `evidence_blobs.sha256`                   | định danh                    | địa chỉ và kiểm toàn vẹn nội dung gốc                      | như trên; nội dung ở `BLOB_DIR` quyền 0600 | cùng vòng đời lần xuất hiện cuối trỏ tới nó                                     |
| `decisions.text`                          | PII (có thể chứa bên thứ ba) | ghi quyết định của dự án kèm nguồn                         | hạn chế truy cập theo workspace            | đến khi xoá dự án hoặc workspace; xoá nguồn giữ quyết định (đánh dấu mất nguồn) |
| `draft_versions.text`                     | PII (có thể chứa bên thứ ba) | soạn trả lời khách, lưu mọi phiên bản để duyệt và đối soát | hạn chế truy cập theo workspace            | xoá cùng hội thoại (cascade) hoặc workspace                                     |
| `members.user_id`                         | định danh                    | quyền thành viên                                           | hạn chế truy cập                           | đến khi gỡ thành viên                                                           |
| `login_throttle.key_hash`                 | định danh                    | giới hạn đăng nhập theo tài khoản                          | HMAC của email, không lưu email rõ         | 24 giờ kể từ lần sai gần nhất                                                   |

- Các cột `account.access_token`, `account.refresh_token`, `account.id_token` do Better Auth tạo cho đăng nhập OAuth; ứng dụng chỉ dùng email + mật khẩu nên luôn rỗng. Nếu sau này bật OAuth phải phân loại là bí mật và mã hoá trước khi lưu.
- Mã hoá at-rest toàn bộ ổ đĩa là việc của người triển khai (volume mã hoá của host); riêng khoá API được mã hoá ở tầng ứng dụng.
- **Thời hạn lưu tin theo workspace (D-010):** "365 ngày" trong bảng là mặc định. Owner đổi được ở trang workspace: 1–36500 ngày (`workspaces.inbox_retention_days`, kiểm ở dịch vụ và CHECK của CSDL), hoặc giữ vô thời hạn (`workspaces.retain_inbox_forever`). Giữ vô thời hạn chỉ hợp lệ khi có căn cứ pháp lý và đã thông báo cho người nhắn tin (Luật 91/2025/QH15); trách nhiệm đó thuộc owner. Phiên, mã xác minh và bộ đếm đăng nhập vẫn dọn như thường.
- **Bằng chứng từ GitHub (connector, ADR-0004):** nội dung issue/PR/review (kèm tên đăng nhập GitHub công khai của tác giả) lưu ở `evidence_blobs` dạng JSON; **không có hạn tự xoá** — giữ tới khi owner xoá (`eraseEvidenceItem`/`eraseProject`, `src/retention/erasure.ts`) hoặc xoá workspace. `connector_cursors` chỉ giữ mốc thời gian và mã lỗi, không có dữ liệu cá nhân. Token GitHub do người gọi cấp mỗi lần, không lưu trong DB (lưu khoá kết nối GitHub là việc của T-209).
- **AI và dữ liệu rời máy (ADR-0005, H6):** AI tắt khi `AI_BASE_URL` trống. Điểm cuối cục bộ (máy/mạng riêng) không cần cờ; điểm cuối đám mây chỉ chạy khi owner bật `workspaces.ai_cloud_enabled` (mặc định tắt) — bật nghĩa là trích đoạn tin của khách có thể được gửi ra ngoài máy chủ, owner chịu trách nhiệm có căn cứ pháp lý, thông báo cho người nhắn tin và hồ sơ đánh giá tác động chuyển dữ liệu. Mỗi lượt gọi ghi `ai_disclosures` TRƯỚC khi gửi (điểm cuối, mô hình, số mục, số byte; không nội dung); nhật ký này **chưa có hạn tự xoá** (giữ tới khi xoá workspace) và không có cột nhạy cảm.
- **Thực thi:** job `maintenance.purge-expired` (`src/retention/service.ts`, chạy 03:17 UTC hằng ngày, xoá theo lô) xoá tin quá hạn của từng workspace (cả `inbox_items` lẫn `messages`, hội thoại không còn tin trong hạn, bản sao bằng chứng của tin — xoá theo khoá ngoại `evidence_items.message_id` — và blob/tệp nội dung không còn lần xuất hiện nào), phiên và mã xác minh hết hạn quá 1 ngày, bộ đếm đăng nhập cũ hơn 24 giờ. Chỉ chạy khi `RUN_WORKERS=true`. Chưa thực thi: xử lý yêu cầu của người nhắn tin (khách không có tài khoản) theo hạn từng loại yêu cầu — hàng chờ DSAR (nợ ghi ở mục 10); xoá tài khoản của chủ tài khoản đã làm (§Quyền chủ thể bên dưới).

### Quyền chủ thể, đồng ý và kiểm kê (STD-PRIV-002/004, CMP-RIGHTS-001/004/007, CMP-VN-001)

- **Vai trò:** chủ workspace là bên kiểm soát dữ liệu của khách nhắn tin; dự án là bên xử lý. Chủ tài khoản là chủ thể của dữ liệu tài khoản (email, tên, phiên).
- **Kiểm kê:** `docs/compliance/data-inventory.csv` (hệ thống, cột, lớp, mục đích, cơ sở pháp lý, thời hạn, bản sao, bên nhận) khớp bảng phân loại ở trên và migration; `tests/config/data-classification.test.ts` đỏ khi lệch. Đây là sổ dữ liệu cá nhân duy nhất (D-030: không lập thêm `docs/privacy/data-map.yaml` trùng nội dung).
- **Xem/xuất (rights-access):** trang `/app/account`, nút "Tải dữ liệu của tôi" → `POST /app/account/export` (POST vì có ghi một dòng audit; JSON: hồ sơ, workspace, đồng ý, phiên, hành động trong audit; không có mật khẩu hay mã phiên). Dữ liệu trong workspace xuất theo dự án (`exportProject`) mới có ở tầng dịch vụ, giao diện chưa có nút (D-040).
- **Xoá (rights-delete):** cùng trang, đòi nhập lại mật khẩu và tích xác nhận. Workspace chỉ có mình bạn bị xoá hẳn (cascade, kể cả tệp nội dung không còn nơi dùng); workspace còn người khác chỉ gỡ bạn khỏi danh sách; chủ duy nhất của workspace còn người khác bị từ chối cho tới khi chuyển quyền. Bản ghi đồng ý, phiên, đăng nhập, người dùng bị xoá. **Giữ lại có căn cứ:** dòng `audit_events` (append-only; sau xoá chỉ còn `actor_id` không gắn tên/email, `source_ip` giữ theo thời hạn ghi nhận an ninh) và các cột `actor_id`/`*_by` trong dữ liệu của workspace còn lại. Chưa có bên xử lý thứ ba nào giữ bản sao ngoài nhà cung cấp AI đám mây (không lưu theo hợp đồng; xem mục AI ở trên).
- **Đồng ý (rights-withdraw-consent):** bật AI đám mây ở trang workspace là cấp đồng ý, ghi vào `consents` (chủ thể, mục đích, phiên bản văn bản, thời điểm, kênh, băm văn bản đã hiển thị); rút = cùng nút, một dòng MỚI có `withdrawn_at`, không sửa dòng cũ. Cổng AI đòi cả cờ lẫn bản ghi đang hiệu lực: rút xong, lượt gọi kế tiếp bị chặn ngay (không có độ trễ). Mục đích hiện có: `ai_cloud`. Chưa có tiếp thị hay chia sẻ cho bên thứ ba nên không có mục đích khác cần đồng ý.
- **Thời hạn xử lý yêu cầu:** thao tác tự phục vụ có hiệu lực tức thì (nhanh hơn mọi mốc theo NĐ 356/2025). Mốc cho yêu cầu của khách không có tài khoản chờ hàng chờ DSAR (CMP-VN-007, chưa làm).

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
- Chủ tài khoản tự xuất và tự xoá dữ liệu của mình (xem mục 5 §Quyền chủ thể). Còn thiếu: hàng chờ yêu cầu của người nhắn tin (khách của workspace, không có tài khoản) với hạn xử lý theo loại yêu cầu (CMP-VN-007, `loop defer`); `members.user_id` chưa có khoá ngoại tới `user.id`.
- Image Docker chưa build được trong môi trường phát triển (không có daemon): cần chạy `docker compose up --build` một lần ở máy có Docker.
- Giả định: người triển khai tự đặt reverse proxy có TLS và ghi đè header IP client.
