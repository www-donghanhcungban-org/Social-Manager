# Danh sách tài khoản và dịch vụ (bàn giao)

Không ghi bí mật ở đây: chỉ ghi tên dịch vụ, ai là chủ và khoá được nạp từ đâu. Giá trị thật nằm trong biến môi trường hoặc trình quản lý bí mật của người triển khai.

| Dịch vụ                           | Dùng cho                             | Chủ              | Khoá/biến nạp từ                        | Ghi chú                                                                    |
| --------------------------------- | ------------------------------------ | ---------------- | --------------------------------------- | -------------------------------------------------------------------------- |
| GitHub (repo `X-Workspace`)       | mã nguồn, CI, ruleset                | chủ dự án        | tài khoản GitHub                        | ruleset `main`: `quality`, `gitleaks` bắt buộc                             |
| SocialAPI (hosted)                | nguồn dữ liệu mạng xã hội            | chủ dự án        | khoá nhà cung cấp lưu mã hoá trong CSDL | khoá thật chưa có trong môi trường phát triển (RK-001)                     |
| Postgres tự host                  | dữ liệu ứng dụng, hàng đợi           | người triển khai | `DATABASE_URL`                          | sao lưu theo `docs/RUNBOOK.md`                                             |
| Khoá chủ mã hoá khoá nhà cung cấp | AES-256-GCM cho khoá lưu trong DB    | người triển khai | biến môi trường (xem README §Cấu hình)  | mất khoá chủ = mất khả năng đọc khoá nhà cung cấp đã lưu                   |
| Cổng AI (tuỳ chọn)                | gợi ý nháp trả lời                   | chủ dự án        | `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY` | tắt mặc định (ADR-0005)                                                    |
| Tên miền, chứng chỉ TLS           | địa chỉ công khai của bản triển khai | người triển khai | reverse proxy của người triển khai      | ngày hết hạn và chủ gia hạn: (chưa xác minh — chưa có bản triển khai thật) |
