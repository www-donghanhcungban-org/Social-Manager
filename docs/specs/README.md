# docs/specs — spec từng tính năng (hợp đồng)

Mỗi tính năng `F-NNN` trong bảng MoSCoW của `PROJECT.md` có một file `docs/specs/F-NNN-<slug>.md` theo mẫu khung `.xtemplates/framework/templates/SPEC.md` (WF-SDD-001, PM-SPEC-001). Chưa `status: approved` thì chưa được code.

## Bắt buộc trong mỗi spec

- Frontmatter YAML ở đầu file: `status: approved`, `approved_by`, `approved_at` (YYYY-MM-DD), `feature: F-NNN`, `requirements: [R-NNN, …]`.
- Dòng `Trạng thái: Approved for implementation` ngay dưới tiêu đề.
- Mục `## 2. Tiêu chí chấp nhận`: mỗi tiêu chí là heading `### AC-xx — <tên>` với ba dòng `Given` / `When` / `Then`; ít nhất một tiêu chí có chữ "ca lỗi" trong tên (WF-SDD-002).
- Mục `## 3. Ca biên`: bảng có cột `Nhóm` phủ 8 nhóm (rỗng/null, cực đại/độ dài, trùng lặp/idempotency, song song, mất mạng giữa chừng, thời gian/múi giờ, quyền, tiền/đơn vị); mỗi dòng trỏ `AC-xx` hoặc ghi `không áp dụng — <lý do>`; tối thiểu 6/8 nhóm (PM-SPEC-003).
- Mục `## 10. Câu hỏi mở`: câu đã đóng ghi `Đã quyết: D-NNN` (D-NNN phải có trong `docs/autopilot/DECISIONS.md`); không còn câu nào thì ghi "Không có" (PM-SPEC-020).

## Quy ước ID scenario ↔ test (PM-SPEC-004, WF-SDD-003)

- Dự án dùng **`AC-xx` làm ID scenario** (thay cho `S-NNN` của mẫu khung); không dùng song song hai hệ ID.
- ID đầy đủ là `F-NNN/AC-xx`. Mỗi AC phải có ít nhất một test dưới `tests/` hoặc `e2e/` chứa đúng chuỗi đó, ưu tiên trong tên test: `it("… [F-001/AC-03]", …)`; khi một test phủ nhiều AC thì ghi nhiều thẻ.
- Map AC → tệp test ghi ở mục `## 12. Truy vết` của spec.

## Kiểm tự động

`npx vitest run tests/config/specs.test.ts` — đỏ khi: thiếu spec hoặc dòng `Trạng thái: Approved`, frontmatter thiếu trường, không có AC/ca lỗi, AC thiếu Given/When/Then, AC không có test trỏ về, bảng ca biên phủ dưới 6/8 nhóm, hoặc `Đã quyết: D-NNN` không có trong `DECISIONS.md`.

## Đổi spec

Sửa spec qua PR; thêm dòng ở bảng "Thay đổi" cuối file; quyết định chuyên môn mới ghi `xt.py loop decide` (D-NNN) và trỏ về từ "Câu hỏi mở".
