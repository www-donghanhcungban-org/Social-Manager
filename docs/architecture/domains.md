# Miền (bounded context) và thư mục `src/` (ARC-MOD-008)

Mỗi thư mục cấp một của `src/` là một dòng `- \`<tên>\``dưới đây;`tests/config/architecture.test.ts`đòi hai danh sách khớp nhau. Tính năng F-xxx xem`PROJECT.md`§2 và`docs/specs/`.

## Miền nghiệp vụ

- `accounts` — tài khoản người dùng và hồ sơ (F-001)
- `workspaces` — workspace, thành viên, thời hạn lưu tin (F-001)
- `connections` — kết nối nhà cung cấp, khoá mã hoá (F-002)
- `inbox` — hộp thư hợp nhất, nhận webhook (F-003)
- `conversations` — hội thoại, đồng bộ, độ phủ (F-003)
- `posts` — bài đăng, hẹn giờ, idempotency (F-004)
- `actions` — nháp, sổ hành động gửi tin, chính sách gửi (ADR-0006)
- `evidence` — kho bằng chứng theo băm (ADR-0004)
- `format` — định dạng số/tiền/ngày giờ bằng Intl theo locale và hằng số đổi đơn vị tập trung
- `knowledge` — dự án, bí danh, sổ quyết định, dòng thời gian (xw-4e)
- `search` — tìm kiếm trong workspace
- `retention` — hạn lưu và xoá dữ liệu (D-010)
- `ai` — cổng AI (ADR-0005)
- `connectors` — nguồn dữ liệu cắm được (GitHub, ADR-0004)
- `providers` — adapter nhà cung cấp kênh (SocialAPI, demo)

## Nền tảng dùng chung

- `auth` — xác thực, phân quyền, giới hạn tần suất
- `db` — kết nối và schema Drizzle
- `config` — cấu hình từ biến môi trường
- `jobs` — hàng đợi và lịch chạy nền
- `http` — lỗi và kiểm sống dùng chung cho route
- `log` — nhật ký có cấu trúc, bộ che bí mật, sự kiện bảo mật
- `audit` — audit trail chỉ ghi thêm cho hành động nhạy cảm
- `observability` — metric RED/token LLM, bọc route đo thời gian
- `security` — CSRF, tiêu đề bảo mật, hộp khoá bí mật
- `server` — điểm nối khung web: container phụ thuộc, tiến trình chạy
