# docs/autopilot/PLAN-xw-1.md — X-Workspace · Đợt xw-1 (nền)

> Duyệt: D-011 (phiên chính tự duyệt) · Kế hoạch: docs/work/2026-11-22-x-workspace-plan/working.md · ADR-0002, ADR-0003 · Blueprint: BLUEPRINT.md

## Mục tiêu của kế hoạch này

Công cụ quy trình thuộc dự án; nền dữ liệu hội thoại đúng ngữ nghĩa trước khi xây tri thức và AI: tin mới của hội thoại
cũ không bị bỏ sót, cùng một tin từ đồng bộ và webhook không thành hai bản, bài đăng không ghi "đã đăng" khi nhà cung
cấp mới nhận, thời hạn lưu tin của khách cấu hình được theo workspace. Chỉ số: các ca trong Gate xanh trên PGlite.

## Ngân sách (4 con số)

- Số vòng tối đa: 60
- Ngân sách: theo phiên
- Timeout mỗi lệnh Gate: 300 giây
- Ngày hết hạn: 2026-11-26T00:00:00Z

## Hạn

| Loại          | Ngày       | Hậu quả nếu trễ | Cách xử lý khi trễ     |
| ------------- | ---------- | --------------- | ---------------------- |
| Hạn mong muốn | 2026-11-26 | nội bộ          | re-plan, không hạ cổng |

## Ủy quyền production

- grant: payments | mode=sandbox | max_per_txn=0 | refund=false
- grant: data_delete | hard_delete=false | max_rows=100
- grant: data_export | pii=false | max_rows=10000
- grant: outbound_messages | live=false | max_per_hour=0
- grant: auth_crypto | custom_crypto=false
- grant: secrets | read_values=false

## Điểm dừng bắt buộc về hành động

- Khoá SocialAPI/AI thật, dịch vụ trả phí, gửi tin thật tới người thật: `loop defer`
- Xoá agent, lệnh, hook cũ (guard chặn agent tự gỡ năng lực/hàng rào): người làm
- Merge PR chạm auth/dữ liệu người dùng khi `merge_hard_exceptions: human`: người merge

## Thứ tự & lý do

1. Lát 1 — công cụ quy trình thuộc dự án, vì mọi task sau chạy qua công cụ đó.
2. Lát 2 — hội thoại và tin nhắn: lỗi định danh làm sai mọi lớp dẫn xuất (H1, H4).
3. Lát 3 — trạng thái bài đăng và thời hạn lưu: trung thực dữ liệu (H2) và nghĩa vụ pháp lý (H5).

## Task

### Lát 1 — Công cụ quy trình thuộc dự án

- [x] `T-101` Tiếp quản công cụ (ADR-0003, D-009): gỡ manifest/băm harness/workflow nâng khung và di sản projects-template, bỏ đăng ký hook chết, may đo AGENTS/CLAUDE; test chặn tái phát. Given repo sau tiếp quản When chạy test Then không còn tệp quản lý bản cài, mọi hook đăng ký gọi qua `bash` và tệp tồn tại, `scripts/` chỉ còn `migrate.mjs`, VERSION không phải SemVer; ca biên: hook đăng ký trỏ tệp không có, lệnh hook không qua bash (files: .xtemplates/, .claude/settings.json, scripts/, tests/config/process-tooling.test.ts, AGENTS.md, CLAUDE.md) — Gate: `npx vitest run tests/config/process-tooling.test.ts`

### Lát 2 — Hội thoại và tin nhắn (M03, H1, H4)

- [x] `T-102` Hợp đồng provider đọc hội thoại và tin nhắn có phân trang: `listConversations({accountId, cursor})`, `listMessages({accountId, conversationId, cursor})`; SocialAPI theo `/inbox/conversations` và `/inbox/conversations/{id}/messages` (cursor, `direction`, `platform_id`); demo cài đặt; bộ hợp đồng chạy trên mọi provider. Ca biên: `next_cursor` rỗng là trang cuối, `platform_id` vắng (Zalo) dùng id nhà cung cấp và gắn `identityWeak`, `direction` lạ bị loại, ngày không múi giờ bị loại (sau: T-101; files: src/providers/, tests/providers/) — Gate: `npx vitest run tests/providers`
- [x] `T-103` Schema `conversations`, `messages` (migration 0006 + down), khoá duy nhất tin theo (tài khoản, external_id), phân loại dữ liệu trong PROJECT.md. Ca biên: trùng khoá bị từ chối, xoá tài khoản xoá theo tầng, `direction` ngoài danh sách bị từ chối, down migration gỡ sạch (sau: T-102; files: src/db/schema.ts, drizzle/, PROJECT.md, tests/db/; exec: deep) — Gate: `npx vitest run tests/db tests/config/data-classification.test.ts`
- [x] `T-104` Đồng bộ hộp thư qua hội thoại + tin nhắn: dừng khi gặp hội thoại cũ hơn mốc đã đồng bộ, lưu tin đầy đủ (không cắt 10.000 ký tự ở bản gốc), mục hộp thư của hội thoại cập nhật theo tin đến mới nhất và mở lại khi có tin đến mới hơn lúc đánh dấu đã xử lý. Given hội thoại cũ có tin mới When đồng bộ Then tin mới vào DB và mục hộp thư mở lại; ca biên: đồng bộ hai lần không nhân đôi, tin gửi đi không mở lại mục, trần số trang, một hội thoại lỗi không chặn hội thoại khác (sau: T-103; files: src/inbox/, src/conversations/, tests/inbox/, tests/conversations/; exec: deep) — Gate: `npx vitest run tests/inbox tests/conversations`
- [ ] `T-105` Webhook `dm.received` ghi tin theo `platform_id` (dự phòng `data.id`) và `conversation_id`, cùng khoá với đồng bộ. Given cùng một tin đến qua webhook rồi qua đồng bộ When cả hai chạy Then DB có đúng một tin; ca biên: webhook đến trước đồng bộ và ngược lại, thiếu `conversation_id` (Zalo), giao trùng (sau: T-104; files: src/providers/socialapi/webhook.ts, src/inbox/webhook.ts, tests/inbox/, tests/providers/) — Gate: `npx vitest run tests/inbox tests/providers`

### Lát 3 — Trung thực trạng thái và thời hạn lưu (H2, H5)

- [ ] `T-106` Trạng thái bài đăng trung thực: nhà cung cấp trả `publishing` → bài ở `submitted`, job xác nhận đọc `GET /posts/{id}` để chuyển `published`/`partial`/`failed`; migration 0007 mở rộng CHECK. Given SocialAPI trả `publishing` When đăng Then bài là `submitted`, chỉ thành `published` sau khi xác nhận; ca biên: `partial`, `cancelled`, trạng thái lạ, xác nhận lỗi mạng giữ nguyên `submitted`, quá hạn xác nhận → `send_unknown` không đăng lại (sau: T-105; files: src/posts/, src/providers/, src/jobs/, src/db/schema.ts, drizzle/, tests/posts/, tests/providers/, tests/jobs/; exec: deep) — Gate: `npx vitest run tests/posts tests/providers tests/jobs tests/db`
- [ ] `T-107` Thời hạn lưu theo workspace (D-010): cột `inbox_retention_days` (NULL = 365) và `retain_inbox_forever` (migration 0008), owner đổi được, job dọn áp theo từng workspace cho mục hộp thư và tin nhắn. Ca biên: giá trị 0/âm/quá 36500 bị từ chối, member/admin không đổi được, giữ vô thời hạn không xoá gì, phiên/mã xác minh vẫn dọn (sau: T-106; files: src/retention/, src/workspaces/, src/auth/permissions.ts, src/db/schema.ts, drizzle/, PROJECT.md, tests/retention/, tests/workspaces/, tests/config/; exec: deep) — Gate: `npx vitest run tests/retention tests/workspaces tests/config tests/db`

### Việc cần người (chép từ đợt trước và mới)

- [ ] `T-009` Tạo `.env.example` khớp schema env và thêm test so khớp tập khoá (BASE-CFG-003) — cần người: quy tắc quyền chặn ghi file `.env*` (D-004) (sau: T-101; files: .env.example, tests/config/env-example.test.ts) — Gate: `npx vitest run tests/config/env-example.test.ts`
- [ ] `T-108` Gỡ 8 tệp hook cũ, 10 agent và 13 lệnh cũ của projects-template — cần người: guard chặn agent tự gỡ hàng rào và năng lực (ADR-0003) (sau: T-101; files: .claude/hooks/, .claude/agents/, .claude/commands/) — Gate: `npx vitest run tests/config/process-tooling.test.ts`

## Phụ thuộc ngoài

| Việc                                     | Bên ngoài | Ngày cam kết | Kế hoạch B                                |
| ---------------------------------------- | --------- | ------------ | ----------------------------------------- |
| Khoá SocialAPI thật + kênh thử (M02)     | chủ dự án | không có     | fixture theo tài liệu, demo provider      |
| Máy Windows thử Agent Desktop (M02, M10) | chủ dự án | không có     | đợt xw-5 chờ; hub làm trước phần ghép nối |
