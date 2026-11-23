---
status: accepted
implementation-status: in-progress
date: 2026-11-22
decision-makers: phiên chính (AGENTS.md §5, D-014)
consulted: docs/work/2026-11-22-x-workspace-plan/working.md §2 (H6, H7, H11, H13); docs/research/2026-11-22-x-workspace-research.md
informed: không
---

# ADR-0005: AI sau một cổng riêng — tắt mặc định, đám mây theo workspace, nhật ký trước khi gửi

## Bối cảnh và vấn đề

Tin nhắn của khách là dữ liệu cá nhân của bên thứ ba (Luật 91/2025/QH15). Gửi trích đoạn cho AI ở nước ngoài là chuyển dữ
liệu ra nước ngoài (H6). Nội dung tin, tài liệu, trang web có thể chứa chỉ thị nhằm điều khiển mô hình (H13). Thư viện AI đổi
bản lớn thường xuyên (H7).

## Yếu tố quyết định

- Đúng và an toàn trước: dữ liệu không rời máy khi chưa được phép; mọi lỗi thất bại đóng.
- Đổi mô hình/thư viện không chạm dịch vụ; không thêm phụ thuộc khi chưa có khoảng thiếu cụ thể.
- Kiểm được trong cổng (không cần mạng hay khoá thật).

## Các phương án đã cân nhắc

1. **Cổng `ModelPort` + adapter OpenAI-tương-thích bằng `fetch`; AI tắt khi `AI_BASE_URL` trống** (chọn).
2. Thêm AI SDK 7 ngay: phụ thuộc lớn chưa cần; vẫn có thể thêm sau như một adapter.
3. Gọi thẳng API của hãng trong dịch vụ: gắn chặt vào một hãng, khó kiểm, khó chặn dữ liệu ra ngoài.

## Quyết định

Chọn phương án 1.

- **Tắt mặc định.** `AI_BASE_URL` trống = không có mô hình; `AI_MODEL` bắt buộc khi đặt `AI_BASE_URL`; `AI_API_KEY` là bí mật (che
  trong log).
- **Cục bộ hay đám mây** quyết định bằng điểm cuối: `localhost`, loopback, địa chỉ mạng riêng, link-local và tên một nhãn (tên
  dịch vụ compose) là cục bộ; mọi tên miền đầy đủ là đám mây.
- **Đám mây chỉ chạy khi owner bật `workspaces.ai_cloud_enabled`** (mặc định tắt). Chưa bật thì không gửi và ghi `blocked`.
- **Nhật ký `ai_disclosures` ghi TRƯỚC khi gửi** (điểm cuối, mô hình, số mục, số byte; không nội dung); không ghi được thì
  không gửi; kết thúc cập nhật `ok`/`error` kèm mã an toàn.
- **Trần 200.000 byte** mỗi lượt gửi.
- **Mô hình không có công cụ ghi**: chỉ nhận chữ, trả chữ; hành động ghi (đợt xw-4) đi qua chính sách bằng mã.

## Hệ quả

- Tốt: dữ liệu không ra ngoài mặc định, có dấu vết đối soát, đổi adapter không chạm dịch vụ.
- Cần làm: thông báo cho người nhắn tin và hồ sơ đánh giá tác động khi owner bật AI đám mây (trách nhiệm của owner, ghi ở
  PROJECT.md); thử với mô hình thật (T-306, chờ người); adapter AI SDK khi có nhu cầu (streaming, tool).
- Chưa làm: ghi nhận nhà cung cấp AI cụ thể vào hồ sơ tuân thủ; hạn lưu cho `ai_disclosures` (hiện giữ tới khi xoá workspace).
