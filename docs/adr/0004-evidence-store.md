---
status: accepted
implementation-status: in-progress
date: 2026-11-22
decision-makers: phiên chính (AGENTS.md §5, D-013)
consulted: docs/work/2026-11-22-x-workspace-plan/working.md §4; docs/research/2026-11-22-x-workspace-research.md
informed: không
---

# ADR-0004: Kho bản gốc theo hash, metadata ở Postgres, nội dung ở thư mục volume

## Bối cảnh và vấn đề

Tri thức và AI (đợt xw-3) chỉ đáng tin nếu mọi khẳng định trích về một bản gốc không đổi. Bản gốc đến từ nhiều nguồn
(tin nhắn, GitHub, tài liệu), có thể được sửa ở nguồn, phải xoá được khi hết hạn lưu hoặc khi chủ dữ liệu yêu cầu (Luật
91/2025/QH15), và phải tách bạch giữa các workspace.

## Yếu tố quyết định

- Đúng và an toàn trước: hash kiểm được toàn vẹn; không workspace nào đọc được dữ liệu của workspace khác.
- Giữ một Postgres và một ứng dụng (ADR-0001); không thêm dịch vụ lưu trữ đối tượng khi chưa cần.
- Xoá được xuyên mọi lớp dẫn xuất (H5): mọi lớp trỏ về bản gốc bằng khoá ngoại để cascade/đối soát được.
- Đường lùi: migration có `.down.sql`; đổi sang S3-tương thích chỉ đổi cổng `BlobStore`.

## Các phương án đã cân nhắc

1. **Metadata trong Postgres, nội dung trong thư mục volume theo `sha256`** (chọn).
2. Nội dung trong cột `bytea`/`text` của Postgres: đơn giản, nhưng phình bảng, sao lưu nặng, không hợp với tài liệu lớn về sau.
3. Dịch vụ đối tượng (S3/MinIO) ngay từ đầu: thêm thành phần vận hành, mặc định tự host không có.

## Quyết định

Chọn phương án 1.

- `evidence_blobs` duy nhất theo `(workspace_id, sha256)`: nội dung giống nhau trong một workspace chỉ một blob; hai
  workspace luôn có hai dòng riêng, quyền đọc theo workspace chứ không theo hash.
- `evidence_items` ghi từng lần xuất hiện (nguồn, id ngoài, thời điểm ở nguồn). Cùng (nguồn, id ngoài, nội dung) là một
  lần (lũy đẳng); nội dung đổi ở cùng id ngoài là phiên bản mới, bản cũ giữ nguyên.
- Cổng `BlobStore` (`put`/`get`/`delete`, khoá là sha256 hex 64 ký tự — chặn đường dẫn tuỳ ý). Bản thư mục ghi tệp tạm rồi
  đổi tên; thư mục cấu hình bằng `BLOB_DIR`.
- Ghi nội dung trước, rồi một giao dịch DB; lỗi giữa chừng không để dòng DB trỏ vào nội dung không có (tệp mồ côi vô hại vì
  địa chỉ theo nội dung). Đọc lại luôn kiểm hash; lệch là `IntegrityError`, không trả nội dung đó.
- Văn bản chuẩn hoá NFC trước khi băm. Nội dung rỗng bị từ chối; trần 5 MiB mỗi bản gốc.
- Loại nội dung cho phép: `text/plain`, `text/markdown`, `application/json` (PDF/scan để đợt sau).

## Hệ quả

- Tốt: toàn vẹn kiểm được, cô lập theo workspace, đổi nơi lưu không chạm dịch vụ.
- Cần làm: dọn tệp mồ côi và tệp không còn dòng nào trỏ tới (đối soát định kỳ, T-207); thư mục `BLOB_DIR` phải là volume
  bền và được sao lưu cùng Postgres — mất volume là mất nội dung dù metadata còn (RUNBOOK ghi bước kiểm).
- Dữ liệu cá nhân bên thứ ba nằm ở đây: thời hạn lưu và xoá theo yêu cầu phải đi qua kho (T-202, T-207), không chỉ xoá ở
  `messages`.
