# Runbook: vi phạm dữ liệu cá nhân (CMP-VN-006, CMP-AUDIT-010)

Cập nhật 2026-11-24. Bổ sung cho [`../incident-response.md`](../incident-response.md): đó là quy trình sự cố chung; tệp này thêm đồng hồ và việc thông báo khi **dữ liệu cá nhân** bị lộ, mất, bị truy cập hoặc sửa trái phép. Căn cứ: Luật 91/2025/QH15 Đ.23 và NĐ 356/2025/NĐ-CP (Mẫu 08) — số Điều và mốc giờ theo nguồn thứ cấp, **chưa đối chiếu bản gốc** (`PROJECT.md` mục Khung pháp lý).

## Đồng hồ

| Việc                                                                                                                                                                                                                              | Hạn                                                                                                  | Căn cứ                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Thông báo cơ quan chuyên trách bảo vệ dữ liệu cá nhân (Bộ Công an) bằng **Mẫu 08**, khi vi phạm có thể gây hại cho quốc phòng/an ninh, trật tự xã hội, hoặc xâm phạm tính mạng, sức khoẻ, danh dự, nhân phẩm, tài sản của chủ thể | **72 giờ** kể từ khi **phát hiện**                                                                   | Luật 91/2025 Đ.23 khoản 1 (chưa đối chiếu bản gốc)      |
| Chủ workspace (bên kiểm soát) biết sự việc                                                                                                                                                                                        | ngay khi đánh giá xong, không chờ hết 72 giờ                                                         | quy trình nội bộ                                        |
| Thông báo chủ thể dữ liệu bị ảnh hưởng                                                                                                                                                                                            | cùng cửa sổ 72 giờ khi có thể gây hại; chủ workspace gửi, X-Workspace cung cấp danh sách và nội dung | quy trình nội bộ; hạn pháp lý chính xác (chưa xác minh) |

Vùng áp dụng: chỉ Việt Nam (D-031). Nếu sau này có người dùng ở nước khác, thêm bảng hạn theo vùng (GDPR Art. 33 72 giờ; PDPA Singapore 3 ngày lịch; PDPA Thái Lan 72 giờ) và lấy hạn **ngắn nhất**.

## Bước

1. **Phát hiện (T0).** Ghi giờ UTC vào mục mới của `../incidents/` (tạo tệp `YYYY-MM-DD-<tên>.md` từ mẫu `.xtemplates/framework/templates/POST-MORTEM.md`). Nguồn: cảnh báo `/api/metrics`, `audit_events` bất thường, người dùng báo.
2. **Ngăn chặn.** Thu hồi phiên và khoá bị lộ, tắt `OUTBOUND_LIVE`, tắt `ai_cloud_enabled`, khoá workspace bị ảnh hưởng; giữ nguyên bằng chứng (không xoá log, không `purge`).
3. **Đánh giá (≤ 24 giờ từ T0).** Dữ liệu nào, của ai, bao nhiêu chủ thể, có thể gây hại theo bảng trên không. Truy vấn: `audit_events` theo khoảng thời gian, `data-inventory.csv` để biết cột nào bị chạm.
4. **Quyết định thông báo (≤ 48 giờ từ T0).** Có thể gây hại → điền Mẫu 08; không → ghi lý do không thông báo vào sổ sự cố (vẫn bắt buộc có bản ghi).
5. **Thông báo (≤ 72 giờ từ T0).** Chủ dự án (người có thẩm quyền pháp lý) nộp Mẫu 08 và gửi chủ workspace; agent chỉ chuẩn bị nội dung, không nộp thay.
6. **Khắc phục và đóng.** Sửa nguyên nhân gốc, kiểm tra lại, đóng bản ghi.
7. **Post-mortem** trong 5 ngày làm việc, mỗi hành động thành issue có người phụ trách và hạn; bổ sung hàng rào (test hồi quy).

## Mẫu nội dung thông báo (điền, không bịa)

- Mô tả sự việc và thời điểm phát hiện (UTC và giờ Việt Nam).
- Loại và số lượng dữ liệu, số chủ thể ước tính.
- Hậu quả có thể xảy ra, biện pháp đã và sẽ làm.
- Đầu mối liên hệ của chủ dự án (điền khi nộp).

## Diễn tập

Diễn tập bàn giấy (tabletop) ≥ 1 lần/năm có biên bản trong `../incidents/`. **Chưa diễn tập lần nào** (2026-11-24): việc của chủ dự án và nhóm vận hành, hạn đề xuất 2027-02-24; ghi `loop defer` ở T-530.
