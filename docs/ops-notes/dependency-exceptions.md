# Ngoại lệ lỗ hổng phụ thuộc

CI (`dep-audit.yml`) chỉ đỏ từ mức **high**. Các mục moderate còn lại phải ghi ở đây kèm hạn xem lại.

| Gói                                                       | Mức      | Mô tả                                                                                 | Vì sao chấp nhận                                                                                                                                                                                                                         | Hạn xem lại |
| --------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `esbuild` ≤ 0.24.2 (qua `drizzle-kit` → `@esbuild-kit/*`) | moderate | GHSA-67mh-4wv8-2f99: trang web bất kỳ gửi được yêu cầu tới **dev server** của esbuild | Chỉ là công cụ phát triển (`drizzle-kit generate`, không chạy dev server), không vào bản build hay server sản phẩm. Bản `drizzle-kit` mới nhất (đã kiểm 2026-11-22) vẫn phụ thuộc chuỗi này; `npm audit fix --force` chỉ hạ xuống 0.18.1 | 2027-02-22  |
