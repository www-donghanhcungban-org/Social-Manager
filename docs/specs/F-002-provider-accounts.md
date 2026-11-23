# F-002 — Kết nối nhà cung cấp và tài khoản mạng xã hội

Trạng thái: đã triển khai (đợt 1). Yêu cầu: R-003.

## Tiêu chí chấp nhận

- Given quản trị viên nhập khoá của nhà cung cấp, When lưu, Then khoá được mã hoá (AES-256-GCM) trong CSDL và không bao giờ hiển thị lại hay ghi vào log.
- Given nhà cung cấp đã kết nối, When thêm tài khoản mạng xã hội, Then tài khoản thuộc đúng workspace và chỉ thành viên của workspace thấy được.
- Given nhà cung cấp không hỗ trợ một khả năng (ví dụ nhắn tin), When người dùng yêu cầu khả năng đó, Then nhận lỗi rõ ràng, không im lặng.
- Phản hồi của nhà cung cấp được kiểm bằng schema trước khi dùng; lỗi 429 tôn trọng `Retry-After`.

## Ca biên

- Khoá rỗng hoặc sai định dạng; nhà cung cấp trả JSON sai schema; hết thời gian chờ.

## Kiểm

- `tests/connections/service.test.ts`, `tests/accounts/service.test.ts`, `tests/providers/`
