# F-003 — Hộp thư hợp nhất

Trạng thái: đã triển khai (đợt 1–2). Yêu cầu: R-004.

## Tiêu chí chấp nhận

- Given tài khoản đã kết nối, When đồng bộ chạy (định kỳ 5 phút hoặc khi có webhook), Then tin nhắn và bình luận mới xuất hiện đúng một lần, kể cả khi đồng bộ lặp.
- Given hộp thư có nhiều tài khoản, When lọc theo tài khoản, trạng thái hoặc từ khoá, Then chỉ thấy mục khớp và thuộc workspace của mình.
- Given một mục, When người dùng đánh dấu đã xử lý, Then trạng thái đổi và có dấu vết người thao tác.
- Webhook phải có chữ ký HMAC hợp lệ trong cửa sổ 5 phút; ghi nhận idempotent.

## Ca biên

- Sự kiện webhook gửi hai lần; chữ ký sai hoặc quá hạn; đồng bộ chạy song song cho cùng một tài khoản.

## Kiểm

- `tests/inbox/service.test.ts`, `tests/inbox/webhook.test.ts`, `tests/conversations/`
