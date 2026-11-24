# Nguồn và giấy phép của ảnh/minh hoạ (UX-VISUAL-007)

Mọi tệp ảnh trong `public/` và `docs/assets/` phải có đúng một hàng dưới đây; `tests/config/design-system.test.ts` so khớp 100% và đỏ khi thiếu hoặc thừa. Không có ảnh do AI tạo (nếu thêm: ghi cột Ghi chú `AI tạo` và gắn nhãn trong giao diện).

| Tệp                                         | Nguồn                                      | Giấy phép / quyền dùng                                                  | Ghi chú                                                                             |
| ------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `docs/assets/donate-vietqr-techcombank.png` | Mã VietQR của chủ dự án (tài khoản ủng hộ) | Tài sản của chủ dự án, dùng trong tài liệu                              | Chứa thông tin tài khoản ngân hàng đã công khai có chủ ý; không dùng trong ứng dụng |
| `public/file.svg`                           | Mẫu `create-next-app` (Next.js, Vercel)    | MIT (Next.js)                                                           | Chưa dùng trong giao diện; đề xuất gỡ                                               |
| `public/globe.svg`                          | Mẫu `create-next-app` (Next.js, Vercel)    | MIT (Next.js)                                                           | Chưa dùng trong giao diện; đề xuất gỡ                                               |
| `public/next.svg`                           | Logo Next.js trong mẫu `create-next-app`   | MIT cho mã mẫu; logo là nhãn hiệu của Vercel (chưa xác minh điều khoản) | Chưa dùng trong giao diện; đề xuất gỡ                                               |
| `public/vercel.svg`                         | Logo Vercel trong mẫu `create-next-app`    | Nhãn hiệu của Vercel (chưa xác minh điều khoản)                         | Chưa dùng trong giao diện; đề xuất gỡ                                               |
| `public/window.svg`                         | Mẫu `create-next-app` (Next.js, Vercel)    | MIT (Next.js)                                                           | Chưa dùng trong giao diện; đề xuất gỡ                                               |

Font: Geist và Geist Mono (Vercel) qua `next/font/google`, giấy phép SIL Open Font License 1.1; Next tải về lúc build và phục vụ từ chính máy chủ này (không gọi Google lúc chạy).
