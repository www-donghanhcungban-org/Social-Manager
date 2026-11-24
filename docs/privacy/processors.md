# Bên xử lý và nhà cung cấp (CMP-AUDIT-007)

Danh mục máy đọc: [`../compliance/vendors.yaml`](../compliance/vendors.yaml) (dịch vụ, dữ liệu chạm, vị trí, DPA, chứng chỉ, rủi ro, ngày rà). Tệp này giải thích quy trình.

- **Rà định kỳ:** mỗi dòng `reviewed` không quá 12 tháng; test `tests/config/repo-docs.test.ts` đỏ khi quá hạn.
- **Dịch vụ mới:** thêm mã gọi ra ngoài (thư mục dưới `src/providers`, `src/connectors`, hoặc `AI_BASE_URL` mới) thì phải thêm một dòng vào `vendors.yaml` trong cùng PR; test so thư mục mã với `code:` của sổ.
- **Đổi bên xử lý phụ (sub-processor):** ghi vào `CHANGELOG.md` cùng thư mục; chủ dự án thông báo cho chủ workspace và, nếu hồ sơ đánh giá tác động đã nộp, cập nhật trong 10 ngày khi đổi nhà cung cấp (theo nguồn thứ cấp, chưa đối chiếu bản gốc).
- **Hợp đồng/DPA:** chưa có với SocialAPI và nhà cung cấp AI đám mây. Đây là việc của chủ dự án (`loop defer` ở T-530); chưa có DPA thì không bật gửi thật và không bật AI đám mây ở môi trường có dữ liệu thật.
