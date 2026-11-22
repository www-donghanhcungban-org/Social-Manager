# Social Manager

Web app tự host để một nhóm quản lý mạng xã hội ở một nơi: hộp thư hợp nhất, đăng bài và lên lịch, tự động trả lời bằng AI, thống kê. Dành cho người/nhóm vận hành nhiều trang và tài khoản muốn giữ dữ liệu và khoá của mình.

Nguồn dữ liệu **cắm được nhiều nhà cung cấp** (`src/providers/`): SocialAPI, demo, và nhà cung cấp tự viết thêm. Mỗi nhà cung cấp khai báo nền tảng × tính năng nó hỗ trợ; tính năng chưa có trả lỗi rõ ràng, không giả vờ chạy.

> Trạng thái: đang xây (đợt 0 xong: lõi provider, mã hoá khoá, schema, đăng nhập, phân quyền, kiểm cấu hình). Chưa có giao diện. Xem `PROGRESS.md`.

## Yêu cầu môi trường

- Node.js 22 hoặc 24 LTS (`.nvmrc`)
- PostgreSQL 15+
- Python 3.15 (chỉ cho công cụ quy trình `.xtemplates/`)

## Cài và chạy

```bash
npm ci
npm run dev
```

## Chạy test

```bash
npm test
```

Cổng đầy đủ: `npm run format:check && npm run lint && npm run type-check && npm test && npm run build`.

## Cấu hình

Cấu hình bằng biến môi trường, kiểm lúc khởi động (thiếu/sai thì dừng, mã thoát 1, chỉ nêu tên biến, không in giá trị):

| Biến                             | Ý nghĩa                                           |
| -------------------------------- | ------------------------------------------------- |
| `DATABASE_URL`                   | Chuỗi kết nối PostgreSQL                          |
| `BETTER_AUTH_SECRET`             | Bí mật phiên đăng nhập, ≥ 32 ký tự                |
| `BETTER_AUTH_URL`                | URL công khai của app                             |
| `APP_SECRET_KEY`                 | Khoá mã hoá khoá nhà cung cấp, base64 của 32 byte |
| `NODE_ENV`, `SOCIALAPI_BASE_URL` | Tuỳ chọn, có giá trị mặc định                     |

Không commit file env; mẫu `.env.example` đang chờ chủ dự án tạo (xem `PROGRESS.md`).

## Đóng góp và liên hệ

Xem `CONTRIBUTING.md`. Báo lỗ hổng theo `SECURITY.md`. Luật làm việc cho AI agent: `AGENTS.md`.

## License

MIT — xem `LICENSE`.
