# Datasheet: bộ đánh giá truy xuất `qa-v1`

Tệp: [`qa-v1.json`](qa-v1.json) · khoá băm: [`qa-v1.lock`](qa-v1.lock). `tests/eval/governance.test.ts` đỏ nếu datasheet này lệch khoá băm, thiếu nguồn/giấy phép hoặc bộ dữ liệu chứa PII.

| Mục                      | Giá trị                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Phiên bản                | 1 (`version: 1`)                                                                                                                     |
| sha256                   | `ec8ff2252746a3a3d8be828d76f0a2f552b2fb9d5377d3469cdef9149f23b40a` (khớp `qa-v1.lock`)                                               |
| Nguồn                    | Tự viết cho dự án (kho giả 20 tài liệu về cửa hàng hoa + 50 câu hỏi); không lấy từ dữ liệu người dùng, web hay bộ dữ liệu bên thứ ba |
| Giấy phép                | MIT (cùng giấy phép dự án, xem `LICENSE`)                                                                                            |
| Mục đích                 | Chỉ đánh giá hồi quy truy xuất (recall@5, tỉ lệ rỗng với câu không có đáp án, độ chính xác theo dự án)                               |
| Tách khỏi huấn luyện     | Dự án không huấn luyện, tinh chỉnh hay dùng few-shot từ dữ liệu: không có tập huấn luyện nào để trùng với tập đánh giá               |
| PII                      | Quét bằng bộ che PII của dự án (`src/ai/redact.ts`): 0 email, 0 CCCD, 0 số điện thoại; địa chỉ chỉ là địa chỉ cửa hàng (xem dưới)    |
| Người chấm / model judge | Không dùng. Grader tất định: so khớp id tài liệu đáp án với kết quả truy xuất                                                        |

## Địa chỉ trong kho giả

Tài liệu `h5` ghi địa chỉ cơ sở kinh doanh của cửa hàng giả ("25 Nguyễn Trãi, quận 5"): là thông tin doanh nghiệp bịa ra, không gắn với một cá nhân. Bộ quét PII của dự án vẫn bắt nó (đúng thiết kế, vì không phân biệt được địa chỉ doanh nghiệp và nhà riêng), nên test cho phép riêng đúng tài liệu này và đỏ nếu có tài liệu khác chứa địa chỉ.

## Cách dùng và baseline

- Chạy trong `npm test` ở CI (`tests/eval/qa.test.ts`), mỗi PR. Baseline là `thresholds` trong `qa-v1.json` (recall@5 ≥ 0,9; rỗng với câu không đáp án = 1; chính xác theo dự án = 1); giảm quá ngưỡng thì đỏ.
- CI không có khoá mô hình và không gọi mô hình thật: truy xuất chạy trên Postgres thử (PGlite), phần mô hình dùng bản giả có kịch bản (`tests/ai/`). Chưa có job đêm gọi mô hình thật.
- Đổi nội dung bộ dữ liệu phải cập nhật `qa-v1.lock` kèm lý do; thay đổi lớn thì tạo `qa-v2` thay vì sửa tại chỗ (mã tham chiếu theo phiên bản trong tên tệp, không có "bản mới nhất").

## Khác với yêu cầu ghi trong blueprint (D-028)

- Dùng khoá băm trong `qa-v1.lock` thay DVC/lakeFS (AI-DATA-001): một bộ dữ liệu nhỏ nằm trong git, thêm công cụ chỉ để theo dõi nó là thừa.
- Dùng chỉ số truy xuất tất định thay `ragas`/`deepeval` (AI-RAG-004): hai công cụ đó cần model judge (Python và khoá mô hình), mà CI không được gọi mô hình thật (AI-EVAL-002). "Context recall" tương ứng là recall@5; "faithfulness" tương ứng là kiểm bằng mã rằng mọi trích dẫn trỏ nguồn đã đưa vào và đầu ra không có URL ngoài nguồn (`tests/ai/answer.test.ts`, `tests/ai/guardrails.test.ts`). Khi có model judge được hiệu chuẩn (≥ 50 mẫu người chấm, báo cáo agreement) thì thêm vào đây.
