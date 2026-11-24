# X-Workspace

Web app tự host để một nhóm quản lý mạng xã hội ở một nơi: hộp thư hợp nhất, đăng bài và lên lịch, tự động trả lời bằng AI, thống kê. Dành cho người/nhóm vận hành nhiều trang và tài khoản muốn giữ dữ liệu và khoá của mình.

Nguồn dữ liệu **cắm được nhiều nhà cung cấp** (`src/providers/`): SocialAPI, demo, và nhà cung cấp tự viết thêm. Mỗi nhà cung cấp khai báo nền tảng × tính năng nó hỗ trợ; tính năng chưa có trả lỗi rõ ràng, không giả vờ chạy.

> Trạng thái: đang xây. Đã có: đăng nhập, workspace và phân quyền, kết nối nhà cung cấp, hộp thư, đăng bài và lịch, hàng đợi nền, nhận webhook SocialAPI (bật ở màn hình Kết nối: dán secret, trỏ SocialAPI tới địa chỉ hiển thị). Chưa có: tự động trả lời AI, thống kê. Xem `PROGRESS.md`.

## Yêu cầu môi trường

- Node.js 22, 24 hoặc 26 LTS (`.nvmrc` ghim 26)
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

| Biến                             | Ý nghĩa                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| `DATABASE_URL`                   | Chuỗi kết nối PostgreSQL                                                                |
| `BETTER_AUTH_SECRET`             | Bí mật phiên đăng nhập, ≥ 32 ký tự                                                      |
| `BETTER_AUTH_URL`                | URL công khai của app                                                                   |
| `APP_SECRET_KEY`                 | Khoá mã hoá khoá nhà cung cấp, base64 của 32 byte                                       |
| `NODE_ENV`, `SOCIALAPI_BASE_URL` | Tuỳ chọn, có giá trị mặc định; URL phải là https                                        |
| `RUN_WORKERS`                    | `true` (mặc định) bật worker nền trong tiến trình                                       |
| `OUTBOUND_LIVE`                  | `false` (mặc định): khoá hệ thống cho gửi tin thật; còn cần owner bật từng workspace    |
| `BLOB_DIR`                       | Thư mục lưu bản gốc tài liệu theo hash (mặc định `./.data/blobs`; sao lưu cùng CSDL)    |
| `AI_BASE_URL`                    | Điểm cuối AI tương thích OpenAI; trống = tắt AI (điểm cuối ngoài máy cần owner bật)     |
| `AI_MODEL`, `AI_API_KEY`         | Tên mô hình và khoá API (bí mật) của điểm cuối AI; khoá có thể bỏ trống khi chạy cục bộ |
| `CLIENT_IP_HEADER`               | Header do reverse proxy đặt chứa IP client                                              |
| `AUTH_RATE_LIMIT_PER_MIN`        | Hạn mức đăng nhập mỗi IP mỗi phút (mặc định 10)                                         |

Không commit file env; mẫu `.env.example` đang chờ chủ dự án tạo (xem `PROGRESS.md`).

## Triển khai tự host (Docker Compose)

Tạo bốn bí mật rồi chạy; thiếu biến nào thì Compose dừng ngay và nêu tên biến:

```bash
export POSTGRES_PASSWORD="$(openssl rand -hex 24)"
export BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
export APP_SECRET_KEY="$(openssl rand -base64 32)"
export BETTER_AUTH_URL="https://social.example.com"
```

```bash
docker compose up -d --build
```

- Container chạy bằng người dùng `node` (không root), tự chạy migration (`scripts/migrate.mjs`) trước khi nghe cổng.
- App publish ở `127.0.0.1:3000` và CSDL không publish ra host. Đặt reverse proxy có TLS (Caddy, nginx) phía trước rồi đặt `CLIENT_IP_HEADER` theo header mà proxy đó ghi đè.
- Ngoài container, `npm start` bind `127.0.0.1`; chỉ `CMD` của container bind `0.0.0.0` để Docker chuyển cổng được.
- Vận hành: [`docs/RUNBOOK.md`](docs/RUNBOOK.md) (deploy, smoke, rollback, sao lưu và khôi phục, xoay bí mật), xử lý sự cố ở [`docs/ops/incident-response.md`](docs/ops/incident-response.md) — người mới nhận trực đọc hai tệp này trước.

## Đóng góp và liên hệ

Xem `CONTRIBUTING.md`. Báo lỗ hổng theo `SECURITY.md`. Luật làm việc cho AI agent: `AGENTS.md`.

## License

MIT — xem `LICENSE`.
