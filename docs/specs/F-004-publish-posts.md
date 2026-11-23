# F-004 — Đăng bài ngay và hẹn giờ

Trạng thái: đã triển khai (đợt 1). Yêu cầu: R-005.

## Tiêu chí chấp nhận

- Given bài đã soạn, When đăng ngay hoặc hẹn giờ, Then việc đăng chạy qua hàng đợi nền và mỗi bài chỉ đăng đúng một lần (không đăng trùng khi chạy lại hay chạy song song).
- Given nhà cung cấp lỗi tạm thời, When thử lại, Then có giới hạn số lần và trạng thái hiển thị đúng sự thật (`đang đăng`, `đã đăng`, `lỗi`, `chưa rõ`).
- Given tiến trình chết giữa chừng, When tác vụ phục hồi chạy, Then bài kẹt chuyển sang trạng thái `chưa rõ` để người quyết định, không tự đăng lại.
- Bài đã gửi nhưng chưa có xác nhận cuối quá 24 giờ chuyển sang `chưa rõ`.

## Ca biên

- Hẹn giờ ở quá khứ; múi giờ (lưu UTC); nội dung rỗng hoặc quá dài.

## Kiểm

- `tests/posts/service.test.ts`, `tests/jobs/runner.test.ts` (và `tests/jobs/pgboss.integration.test.ts` trên Postgres thật ở CI)
