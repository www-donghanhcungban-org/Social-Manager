# docs/autopilot/PLAN.md — Social Manager · Đợt 0 (nền)

> Duyệt: D-001 (phiên chính tự duyệt) · Kế hoạch gốc: docs/work/2026-11-22-social-manager-plan/working.md · Blueprint: BLUEPRINT.md · ADR: docs/adr/0001-stack.md
>
> - Vấn đề: quản lý nhiều tài khoản mạng xã hội rời rạc, bot tự trả lời chỉ chạy khi app mở.
> - Người dùng: chủ shop/nhóm nhỏ quản lý nhiều trang, tự host.
> - Chỉ số: bot trả lời đúng khi không có ai mở trình duyệt (server chạy liên tục).
> - Không làm (đợt 0): giao diện hộp thư, bot AI, thống kê, PWA.

## Mục tiêu của kế hoạch này

Nền chạy được: cổng xanh đủ sàn M, hợp đồng provider có test chạy trên mọi provider, client SocialAPI an toàn,
kho khoá mã hoá, schema Postgres có migration, đăng nhập + vai trò theo workspace.

## Ngân sách (4 con số)

- Số vòng tối đa: 60
- Ngân sách: theo phiên
- Timeout mỗi lệnh Gate: 300 giây
- Ngày hết hạn: 2026-11-25T00:00:00Z

## Hạn

| Loại          | Ngày       | Hậu quả nếu trễ | Cách xử lý khi trễ     |
| ------------- | ---------- | --------------- | ---------------------- |
| Hạn mong muốn | 2026-11-25 | nội bộ          | re-plan, không hạ cổng |

## Ủy quyền production

- grant: payments | mode=sandbox | max_per_txn=0 | refund=false
- grant: data_delete | hard_delete=false | max_rows=100
- grant: data_export | pii=false | max_rows=10000
- grant: outbound_messages | live=false | max_per_hour=0
- grant: auth_crypto | custom_crypto=false
- grant: secrets | read_values=false

## Điểm dừng bắt buộc về hành động

- Khoá SocialAPI/AI thật, dịch vụ trả phí, gửi tin thật tới người dùng thật: `loop defer`
- Xoá/đổi dữ liệu thật, migration phá vỡ trên production
- Merge PR chạm auth/mật mã khi `merge_hard_exceptions: human` (người merge)

## Thứ tự & lý do

1. Lát 1 — Gate đủ sàn M trước, vì mọi task sau dựa vào cổng thật.
2. Lát 2 — Hợp đồng provider + client SocialAPI: rủi ro lớn nhất là phụ thuộc bên ngoài, test bằng fetch giả.
3. Lát 3 — Kho khoá, schema, đăng nhập: nền dữ liệu và bảo mật cho mọi đợt sau.

## Task

### Lát 1 — Cổng đủ sàn M

- [x] `T-001` Thêm format_check (prettier), coverage có ngưỡng, khai ở xt.yaml (sàn M) — Gate: `.xtemplates/scripts/dev-task.sh gate`

### Lát 2 — Provider

- [ ] `T-002` Hợp đồng hành động provider (`listInbox`, `publishPost`) + demo cài đặt; test hợp đồng chạy trên MỌI provider đã đăng ký. Given provider không hỗ trợ khả năng → ném lỗi `unsupported` có mã, không trả rỗng giả; ca biên: danh sách rỗng, nội dung rỗng (sau: T-001; files: src/providers/, tests/providers/) — Gate: `npx vitest run tests/providers`
- [ ] `T-003` Client SocialAPI: Zod validate phản hồi, envelope lỗi `{error:{code,message}}`, tôn trọng `Retry-After` khi 429, fetch tiêm vào (không gọi mạng thật trong test). Ca biên: body không phải JSON, 429 không có header, key rỗng (sau: T-002; files: src/providers/socialapi/, tests/providers/socialapi/; topo: review) — Gate: `npx vitest run tests/providers/socialapi`

### Lát 3 — Bảo mật & dữ liệu

- [ ] `T-004` Kho khoá mã hoá AES-256-GCM (node:crypto), khoá chủ từ biến môi trường, định dạng có phiên bản. Ca biên: bản mã bị sửa 1 byte → lỗi, sai khoá → lỗi, cùng bản rõ hai lần ra hai bản mã khác nhau, khoá sai độ dài (sau: T-001; files: src/security/, tests/security/; topo: review) — Gate: `npx vitest run tests/security`
- [ ] `T-005` Schema Drizzle + migration có đường lùi: workspaces, members(role), provider_connections(credentials mã hoá), social_accounts; thử trên PGlite. Ca biên: xoá workspace xoá theo tầng, trùng (workspace, provider, account) bị từ chối, role ngoài danh sách bị từ chối (sau: T-004; files: src/db/, drizzle/, tests/db/; exec: deep) — Gate: `npx vitest run tests/db`
- [ ] `T-006` Đăng nhập Better Auth + vai trò owner/admin/member theo workspace, kiểm quyền ở server. Ca biên: member không đổi được vai trò, owner cuối không tự xoá mình, phiên hết hạn (sau: T-005; files: src/auth/, app/api/auth/, tests/auth/; exec: deep; topo: review) — Gate: `npx vitest run tests/auth`

## Phụ thuộc ngoài

| Việc                | Bên ngoài | Ngày cam kết | Kế hoạch B                |
| ------------------- | --------- | ------------ | ------------------------- |
| Khoá SocialAPI thật | chủ dự án | không có     | demo provider + fetch giả |
