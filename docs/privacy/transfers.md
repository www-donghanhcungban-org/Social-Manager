# Luồng dữ liệu cá nhân ra ngoài Việt Nam (CMP-VN-004)

Cập nhật 2026-11-24. Căn cứ: Luật 91/2025/QH15 Đ.20 và NĐ 356/2025/NĐ-CP Đ.18 khoản 4 (hồ sơ đánh giá tác động chuyển dữ liệu nộp trong 60 ngày kể từ lần chuyển đầu) — số Điều theo nguồn thứ cấp, **chưa đối chiếu bản gốc**. Việc nộp hồ sơ là của chủ dự án; tệp này là danh mục để điền hồ sơ.

Sản phẩm tự host: Postgres và kho blob nằm trên máy của chủ triển khai, không phải luồng ra ngoài nếu máy đặt ở Việt Nam (vị trí máy: chủ dự án xác nhận, chưa xác minh).

| Luồng         | Điều kiện chạy                                                              | Dữ liệu                                                     | Bên nhận                               | Quốc gia                         | Cơ chế/ghi chú                                                                    | Trạng thái hồ sơ                                                |
| ------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `socialapi`   | có khoá SocialAPI và kết nối workspace                                      | tin nhắn, hồ sơ khách; tin trả lời khi `OUTBOUND_LIVE=true` | SocialAPI `api.social-api.ai`          | (chưa xác minh)                  | https bắt buộc; chưa có DPA                                                       | chưa nộp                                                        |
| `ai-endpoint` | `AI_BASE_URL` đặt tới điểm cuối không cục bộ **và** owner đồng ý AI đám mây | trích đoạn đã che PII                                       | nhà cung cấp AI do chủ triển khai chọn | tuỳ nhà cung cấp (chưa xác minh) | đồng ý ghi ở `consents`; điểm cuối cục bộ (Ollama/vLLM) không phải luồng ra ngoài | chưa nộp, chỉ cần khi bật                                       |
| `github`      | có token GitHub chỉ đọc cho repo pilot                                      | nội dung issue/PR đã nhập                                   | GitHub `api.github.com`                | (chưa xác minh)                  | dữ liệu đi **vào**, token đi ra                                                   | không phải chuyển dữ liệu cá nhân của khách; ghi để đủ danh mục |

Chênh lệch giữa danh mục này và `docs/compliance/vendors.yaml` phải bằng 0 (`tests/config/repo-docs.test.ts`).
