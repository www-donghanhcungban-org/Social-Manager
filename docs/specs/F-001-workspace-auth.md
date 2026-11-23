# F-001 — Đăng ký, đăng nhập, workspace nhiều thành viên

Trạng thái: đã triển khai (đợt 0–1). Yêu cầu: R-001, R-002.

## Tiêu chí chấp nhận

- Given người dùng chưa có tài khoản, When đăng ký bằng email và mật khẩu hợp lệ, Then có tài khoản và một workspace do họ làm `owner`.
- Given mật khẩu sai nhiều lần liên tiếp, When thử đăng nhập tiếp, Then bị giới hạn tốc độ theo tài khoản (không khoá vĩnh viễn).
- Given người dùng không thuộc workspace W, When đọc hay sửa bất kỳ tài nguyên của W (kể cả đoán ID), Then nhận "không tìm thấy" như tài nguyên không tồn tại (không lộ sự tồn tại).
- Given workspace có hai `owner`, When hai owner cùng hạ quyền hoặc cùng rời đi song song, Then luôn còn đúng ít nhất một `owner`.
- Vai trò `owner` > `admin` > `member`: thao tác nào cần vai trò nào do một bảng quyền duy nhất quyết định ở server.

## Ca biên

- Mật khẩu rỗng, quá ngắn hoặc có ký tự Unicode: kiểm bằng schema, băm Argon2id.
- Thành viên bị xoá trong lúc đang có phiên: lần gọi kế tiếp bị từ chối.

## Kiểm

- `tests/auth/` (idor, permissions, members, password, throttle; `members.pg.test.ts` chạy trên Postgres thật ở CI)
- `tests/workspaces/service.test.ts`
