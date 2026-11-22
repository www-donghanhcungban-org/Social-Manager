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

- [x] `T-002` Hợp đồng hành động provider (`listInbox`, `publishPost`) + demo cài đặt; test hợp đồng chạy trên MỌI provider đã đăng ký. Given provider không hỗ trợ khả năng → ném lỗi `unsupported` có mã, không trả rỗng giả; ca biên: danh sách rỗng, nội dung rỗng (sau: T-001; files: src/providers/, tests/providers/) — Gate: `npx vitest run tests/providers`
- [x] `T-003` Client SocialAPI: Zod validate phản hồi, envelope lỗi `{error:{code,message}}`, tôn trọng `Retry-After` khi 429, fetch tiêm vào (không gọi mạng thật trong test). Ca biên: body không phải JSON, 429 không có header, key rỗng (sau: T-002; files: src/providers/socialapi/, tests/providers/socialapi/; topo: review) — Gate: `npx vitest run tests/providers/socialapi`

### Lát 3 — Bảo mật & dữ liệu

- [x] `T-004` Kho khoá mã hoá AES-256-GCM (node:crypto), khoá chủ từ biến môi trường, định dạng có phiên bản. Ca biên: bản mã bị sửa 1 byte → lỗi, sai khoá → lỗi, cùng bản rõ hai lần ra hai bản mã khác nhau, khoá sai độ dài (sau: T-001; files: src/security/, tests/security/; topo: review) — Gate: `npx vitest run tests/security`
- [x] `T-005` Schema Drizzle + migration có đường lùi: workspaces, members(role), provider_connections(credentials mã hoá), social_accounts; thử trên PGlite. Ca biên: xoá workspace xoá theo tầng, trùng (workspace, provider, account) bị từ chối, role ngoài danh sách bị từ chối (sau: T-004; files: src/db/, drizzle/, tests/db/; exec: deep) — Gate: `npx vitest run tests/db`
- [x] `T-006` Quy tắc vai trò owner/admin/member theo workspace, kiểm quyền ở server (D-002 tách từ T-006 cũ). Ca biên: member không đổi được vai trò, admin không đụng được owner hay nâng ai lên owner, owner cuối không bị hạ vai/xoá (kể cả tự xoá mình), người ngoài workspace không làm gì được, thao tác trên người không phải thành viên (sau: T-005; files: src/auth/permissions.ts, src/auth/members.ts, tests/auth/; exec: deep; topo: review) — Gate: `npx vitest run tests/auth`
- [x] `T-007` Nối Better Auth: đăng ký/đăng nhập email + mật khẩu trên Postgres, route `/api/auth/*`, bảng người dùng bằng migration. Ca biên: đăng ký trùng email bị từ chối, sai mật khẩu bị từ chối, phiên hết hạn không còn dùng được, thiếu secret thì dừng (sau: T-006; files: src/auth/auth.ts, app/api/auth/, drizzle/, tests/auth-integration/; exec: deep; topo: review) — Gate: `npx vitest run tests/auth-integration`
- [x] `T-008` Cấu hình và bí mật (BASE-CFG-001/002/005/007/008, BASE-SEC-005; D-003): schema env Zod validate lúc khởi động, thiếu/sai → thoát mã ≠ 0 chỉ nêu TÊN biến, che bí mật khi in, không biến bí mật nào có tiền tố `NEXT_PUBLIC_`, mặc định an toàn. Ca biên: giá trị rỗng coi như thiếu, thông báo lỗi không chứa giá trị bí mật, URL sai định dạng, khoá chủ sai độ dài (sau: T-007; files: src/config/, instrumentation.ts, playwright.config.ts, tests/config/) — Gate: `npx vitest run tests/config`
- [ ] `T-009` Tạo `.env.example` khớp schema env và thêm test so khớp tập khoá (BASE-CFG-003) — cần người: quy tắc quyền chặn ghi file `.env*` (D-004) (sau: T-008; files: .env.example, tests/config/env-example.test.ts) — Gate: `npx vitest run tests/config/env-example.test.ts`

## Phụ thuộc ngoài

| Việc                | Bên ngoài | Ngày cam kết | Kế hoạch B                |
| ------------------- | --------- | ------------ | ------------------------- |
| Khoá SocialAPI thật | chủ dự án | không có     | demo provider + fetch giả |
- [x] `T-010` Tài liệu và tệp cộng đồng (BASE-DOC-001, BASE-REPO-002/003/004/007, BASE-SEC-009): README thật, CHANGELOG Keep a Changelog, LICENSE khớp package.json, SECURITY có kênh báo lỗi, `.gitattributes`, không artefact/env trong git. Ca biên: không còn lời mẫu create-next-app; CRLF ngoài khai báo = lỗi (sau: T-008; files: README.md, CHANGELOG.md, package.json, tests/config/repo-docs.test.ts) — Gate: `npx vitest run tests/config/repo-docs.test.ts`
- [x] `T-011` Logger có cấu trúc (BASE-ERR-005/006/007/008/009): JSON một dòng, trường OTel, che bí mật, escape CR/LF, exception.* kèm chuỗi nguyên nhân. Ca biên: tham chiếu vòng, cây sâu, giá trị ném không phải Error, trường gọi không ghi đè trường lõi (sau: T-008; files: src/log/logger.ts, tests/log/logger.test.ts) — Gate: `npx vitest run tests/log`
- [x] `T-012` Sửa phát hiện review độc lập đợt 0 (🟠1-6, 🟡7/8/12): down migration xoá dòng sổ drizzle; trạng thái đăng bài lạ → lỗi; giờ hẹn phải ISO có múi giờ và chuẩn hoá UTC; ngày hội thoại sai → client.invalid_response; test khoá workspace bắt SQL; đăng ký không lộ email; khoá chủ base64 chuẩn; removeMember kiểm quyền trước khi tra mục tiêu. Ca biên: 2027-02-30, thiếu offset, __proto__ (sau: T-011; files: src/providers, src/auth, src/security, drizzle/*.down.sql, tests/) — Gate: `npm test`
- [x] `T-013` Xử lý lỗi và timeout (BASE-ERR-002/003/004; review 🟡10): `handleError` đổi lỗi → HTTP không lộ chi tiết (500/502/504 chung, thất bại đóng), handler unhandledRejection/uncaughtException, biên lỗi UI chỉ hiện digest, timeout cho fetch SocialAPI và pool Postgres, Retry-After chặt. Ca biên: giá trị ném không phải Error, Retry-After 0/âm/ngày, fetch treo (sau: T-011; files: src/http/errors.ts, src/log/process.ts, src/db/client.ts, app/error.tsx, instrumentation.ts) — Gate: `npm test`
- [x] `T-014` Phụ thuộc (BASE-DEP-001/002/003/004/007): lockfile theo dõi và khớp manifest, phụ thuộc runtime ghim đúng, Node LTS, workflow quét lỗ hổng mỗi PR + hằng tuần (từ high là đỏ), ngoại lệ moderate có hạn, Dependabot cho npm. Ca biên: ngoại lệ quá hạn thì test đỏ; test không gọi mạng (sau: T-010; files: .github/dependabot.yml, .github/workflows/dep-audit.yml, docs/ops-notes/dependency-exceptions.md, tests/config/deps.test.ts) — Gate: `npx vitest run tests/config/deps.test.ts`
- [x] `T-015` Dịch vụ kết nối nhà cung cấp (đợt 1): tạo/liệt kê/xoá kết nối theo workspace, khoá mã hoá trước khi lưu, không bao giờ trả khoá ra ngoài, quyền connections.manage. Given admin When tạo kết nối demo Then DB chỉ có bản mã `v1:`; ca biên: member/người ngoài bị Forbidden, nhãn NFC và trùng nhãn, id không phải UUID, workspace khác, bản mã bị sửa (sau: T-005, T-006; files: src/connections/service.ts, tests/connections/service.test.ts) — Gate: `npx vitest run tests/connections`
- [x] `T-016` Đăng bài và hẹn giờ (đợt 1): bảng `posts` (migration 0002 + down), `schedule` có idempotency, `runDue` nhận bài bằng SKIP LOCKED rồi đăng qua provider, `recoverStuck`. Given bài hẹn 10:00 When worker chạy lúc 10:00 Then published đúng một lần; ca biên: giờ hẹn quá khứ/thiếu múi giờ/2027-02-30, cùng khoá khác nội dung, hai worker song song, lỗi nhà cung cấp không lộ nội dung, bài kẹt không tự đăng lại (sau: T-015; files: src/posts/service.ts, src/db/schema.ts, drizzle/0002_posts*.sql, tests/posts/service.test.ts) — Gate: `npx vitest run tests/posts tests/db`
- [x] `T-017` Hộp thư hợp nhất (đợt 1): bảng `inbox_items` (migration 0003 + down), `sync` nhập tin từ provider idempotent, `list` phân trang keyset + lọc, `setStatus`. Given provider trả 1 DM When sync hai lần Then DB có đúng 1 mục; ca biên: loại chưa cài (skipped), một loại lỗi không chặn loại khác và không lộ nội dung lỗi, mục sai (id rỗng, ngày không múi giờ) bị loại, trùng giờ khi phân trang, cursor hỏng, workspace khác, đã xử lý không bị ghi đè (sau: T-016; files: src/inbox/service.ts, src/auth/access.ts, drizzle/0003_inbox*.sql, tests/inbox/service.test.ts) — Gate: `npx vitest run tests/inbox tests/db`
