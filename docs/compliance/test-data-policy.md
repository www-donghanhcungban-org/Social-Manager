# Chính sách dữ liệu test (QA-DATA-001, QA-DATA-002)

Áp dụng cho mọi fixture, seed, ảnh chụp, bản ghi E2E trong `tests/`, `e2e/` và CI.

## Quy tắc

1. **Không dữ liệu production** trong repo, CI, staging hay máy dev: không dump `.sql`, export `.csv`/`.json` từ hệ thống thật. File dữ liệu lớn hơn 1 MB không đưa vào repo.
2. **Dữ liệu tổng hợp**: tên, nội dung tin nhắn, bài đăng do người viết test tự nghĩ ra.
3. **Email test** chỉ dùng tên miền dành riêng `example.com` / `example.test` / `example.org` (RFC 2606), hoặc dạng `e2e-<uuid>@example.com` cho E2E để mỗi lần chạy có danh tính riêng.
4. **Không có số điện thoại, CCCD, địa chỉ thật** trong fixture. Nếu cần minh hoạ định dạng, dùng số mẫu ghi ở mục dưới.
5. **Không dùng bản sao ẩn danh hoá** dữ liệu thật. Nếu sau này cần, phải có `scripts/anonymize/` có phiên bản, kỹ thuật không đảo ngược, phê duyệt ghi ở `docs/compliance/anonymization.md` (`approved_by`) và test chứng minh không truy ngược được bản ghi gốc.
6. **E2E tự tạo dữ liệu** qua giao diện (đăng ký người dùng mới mỗi test) trên CSDL tạm của CI hoặc CSDL cục bộ chuyên dụng (`E2E_DATABASE_URL`); hết lượt thì bỏ cả CSDL tạm. Không trỏ E2E vào CSDL có dữ liệu thật.

## Số mẫu được phép trong fixture

Không có số điện thoại mẫu nào được phép ở thời điểm này (danh sách rỗng). Thêm vào đây trước khi dùng trong fixture.

## Cưỡng chế

`tests/config/test-strategy.test.ts` quét fixture/test: email ngoài tên miền dành riêng, số điện thoại VN dạng thật, file dữ liệu > 1 MB. gitleaks chạy ở CI.
