# Lưu trữ phía trình duyệt (FE-STATE-008, FE-SEC-005)

Cập nhật: 2026-11-23.

**Danh sách đã duyệt: rỗng.** Ứng dụng không dùng `localStorage`, `sessionStorage`, `IndexedDB`, `document.cookie` hay thư viện lưu bền phía client (`persist`). Mọi trạng thái nằm ở server (Postgres) và được hiển thị qua Server Component/Server Action.

- Phiên đăng nhập chỉ là cookie do Better Auth đặt: `HttpOnly` (JS không đọc được), `Secure`, `Path=/`, `SameSite=Lax`, tiền tố `__Host-` trên https (`src/auth/auth.ts`).
- Không lưu token, email hay dữ liệu nhạy cảm ở trình duyệt.

Thêm bất kỳ nơi lưu nào ở trình duyệt phải: ghi key vào bảng dưới (mục đích, dữ liệu, hạn), và `tests/security/web-security.test.ts` mới cho qua.

| Key        | Nơi lưu | Mục đích | Dữ liệu | Hạn |
| ---------- | ------- | -------- | ------- | --- |
| (không có) |         |          |         |     |
