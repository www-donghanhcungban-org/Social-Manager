---
status: accepted
implementation-status: in-progress
date: 2026-11-23
decision-makers: phiên chính (AGENTS.md §5, D-015)
consulted: docs/work/2026-11-22-x-workspace-plan/working.md §2 (H3, H12, H13, H14); docs/autopilot/PLAN-xw-4.md
informed: không
---

# ADR-0006: Gửi tin ra ngoài qua sổ hành động — đúng một lần, hai khoá, không tự gửi lại khi chưa chắc

## Bối cảnh và vấn đề

Gửi tin tới khách là hành động không đảo ngược và có thể mất uy tín hoặc vi phạm cửa sổ nhắn tin của nền tảng. Gọi mạng có
thể hết giờ SAU khi nhà cung cấp đã nhận: gửi lại là gửi trùng; không gửi lại là có thể mất tin (H3, H12, H14).

## Yếu tố quyết định

- Đúng và an toàn trước: thà không gửi còn hơn gửi trùng hoặc gửi khi chưa được phép.
- Kết quả không chắc phải được ghi và giải quyết bằng bằng chứng hoặc người, không bằng thử lại.
- Kiểm được bằng nhà cung cấp giả, không cần khoá hay tin thật.

## Các phương án đã cân nhắc

1. **Sổ hành động + nháp có phiên bản + chính sách bằng mã + hai khoá bật gửi** (chọn).
2. Gửi thẳng từ Server Action: không có chỗ ghi trạng thái không chắc, không chống trùng, khó tắt khẩn cấp.
3. Thử lại tự động khi lỗi: gửi trùng khi nhà cung cấp đã nhận (không có header idempotency).

## Quyết định

Chọn phương án 1.

- **Nháp** (`drafts`, `draft_versions`) có khoá lạc quan; chỉ nháp ở trạng thái mở mới yêu cầu gửi được.
- **Sổ hành động** (`action_ledger`): khoá idempotency theo workspace; chỉ MỘT hành động còn sống cho mỗi nháp (chỉ mục duy
  nhất từng phần); `attempts ≤ 1` (CHECK); nhận việc bằng UPDATE có điều kiện nên hai worker không cùng gửi một hành động.
- **Chính sách `evaluateSendPolicy` là hàm thuần**, kiểm lại ở cả lúc yêu cầu và lúc gửi: cờ tắt, có tin đến, cửa sổ nhắn
  tin (Facebook/Instagram/WhatsApp 24 giờ, Zalo 7 ngày, mặc định 24 giờ), độ dài (Facebook 2000 ký tự, Instagram 1000 byte),
  hạn mức giờ theo workspace. Bị chặn vẫn ghi một dòng `blocked` kèm mã lý do.
- **Hai khoá độc lập**: `OUTBOUND_LIVE` của hệ thống (mặc định `false`, đọc mỗi lần) và `workspaces.outbound_enabled` do
  owner bật (mặc định tắt). Tác tử không bật khoá nào và không thử gửi thật; cờ tắt thì việc đã xếp hàng giữ nguyên.
- **Từ chối chắc chắn** (4xx trừ 408, `success:false`) → `failed`. **Mọi trường hợp khác** (hết giờ, mất kết nối, 5xx, phản
  hồi sai hình dạng) → `send_unknown`, KHÔNG BAO GIỜ gửi lại.
- **Đối soát** chỉ đọc: tìm tin gửi đi cùng băm nội dung (NFC, cắt khoảng trắng) với `sentAt ≥ dispatchedAt − 60 giây`; thấy →
  `confirmed`; không thấy → vẫn `send_unknown` (không chứng minh được là chưa gửi). Quá 24 giờ thì để admin/owner quyết
  (`actions.resolve`): `sent` hoặc `not_sent`; sau `not_sent` người có thể yêu cầu gửi MỚI với khoá mới.
- **Huỷ**: `queued` → `cancelled`; đang gửi → `cancel_requested` (không rút lại được tin đã đi, kết quả thật vẫn ghi).

## Hệ quả

- Tốt: không đường nào gọi `sendMessage` lần hai; tắt khẩn cấp bằng một cờ; mọi quyết định có dấu vết.
- Đánh đổi: có thể `send_unknown` kéo dài đến khi người quyết; không có thời hạn tự động (chấp nhận, ưu tiên không gửi trùng).
- Chưa xác minh với khoá thật: hình dạng phản hồi gửi của SocialAPI, tên mã khi hết cửa sổ (nhận theo từ khoá
  `window|expired|24`), độ trễ để tin gửi đi hiện trong `listMessages`. Việc bật gửi thật là T-406 (cần người).

## Đường lùi

Đặt `OUTBOUND_LIVE=false` dừng mọi đường gửi; migration 0018, 0019 có `.down.sql`.
