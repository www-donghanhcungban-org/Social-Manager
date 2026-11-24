---
status: approved
approved_by: phiên chính (tự duyệt, ADR-0008, D-041)
approved_at: 2026-11-24
feature: F-007
requirements: [R-001]
---

# SPEC F-007 — Tài liệu, dự án và tìm kiếm trong workspace

Trạng thái: Approved for implementation

| Trường       | Giá trị                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| ID tính năng | F-007 (không có R riêng; áp R-001 cô lập workspace)                                                                |
| Phiên bản    | 1 — spec bù cho mã đã có (đợt xw-2, xw-3, D-013, D-014); thay đổi: xem cuối file                                   |
| Chủ spec     | phiên chính · Duyệt bởi phiên chính (D-041) ngày 2026-11-24                                                        |
| Hồ sơ/quy mô | web-app / M                                                                                                        |
| Quy ước ID   | `AC-xx` là ID scenario; test ghi `F-007/AC-xx` (xem `README.md`)                                                   |
| Mã nguồn     | `src/evidence/`, `src/knowledge/service.ts`, `src/search/`, `app/app/[workspaceId]/{documents,projects,search}/**` |

## 1. User story

Là thành viên workspace, tôi muốn nhập tài liệu, gom tin nhắn và tài liệu theo dự án (kèm bí danh và sổ quyết định có nguồn) và tìm lại được bằng từ khoá có dấu hay không dấu, để tra cứu công việc nhanh mà luôn dẫn được về bản gốc.

## 2. Tiêu chí chấp nhận

### AC-01 — Nhập tài liệu lưu bản gốc theo hash và tìm được ngay

- Given admin/owner (quyền `evidence.write`) ở trang Tài liệu
- When nhập tiêu đề (1–200 ký tự) và nội dung văn bản
- Then nội dung chuẩn hoá NFC lưu một lần theo sha256 (kho thư mục `<2 ký tự đầu>/<sha256>`), một lần xuất hiện nguồn `document` với id ngoài là tiêu đề; chỉ mục tìm kiếm ghi trong cùng giao dịch nên tìm được ngay; đọc lại luôn kiểm hash; cùng nội dung ở hai id ngoài dùng chung một blob

### AC-02 — Nhập lại lũy đẳng; đổi nội dung là phiên bản mới

- Given tài liệu đã nhập
- When nhập lại đúng tiêu đề và nội dung (kể cả dạng NFD), hoặc cùng tiêu đề với nội dung khác
- Then lần đầu không tạo thêm gì và báo "đã có"; nội dung khác là phiên bản mới, bản cũ vẫn còn; tìm kiếm mặc định chỉ trả phiên bản mới nhất của mỗi (nguồn, id ngoài), phiên bản cũ chỉ khi `allVersions`

### AC-03 — Nội dung không hợp lệ hoặc kho hỏng (ca lỗi)

- Given nội dung rỗng hoặc vượt 5 MiB, tiêu đề rỗng/quá dài, nguồn hay loại nội dung lạ, ngày hỏng; hoặc kho nội dung lỗi ghi, bị sửa, bị mất
- When nhập hoặc đọc lại
- Then `ValidationError` và không ghi gì (đúng 5 MiB được nhận); lỗi ghi kho hay lỗi CSDL không để lại dòng nào trỏ tới nội dung không có; nội dung lệch hash là `IntegrityError`, mất là `NotFound` — không bao giờ trả nội dung sai

### AC-04 — Dự án và bí danh

- Given admin/owner (quyền `projects.write`)
- When tạo dự án, thêm hoặc gỡ bí danh ở trang Tài liệu hay trang dự án
- Then tên/bí danh chuẩn hoá NFC, gộp khoảng trắng, dài 1–100 ký tự; so trùng không phân biệt hoa thường và dạng Unicode; trùng tên dự án là `name_taken`, bí danh trùng bí danh khác hay trùng tên một dự án là `alias_taken`, tên trùng bí danh là `name_taken`; trần 200 dự án mỗi workspace (`project_limit`) và 20 bí danh mỗi dự án (`alias_limit`)

### AC-05 — Liên kết nguồn vào dự án (tầng dịch vụ)

- Given dự án và một hội thoại hoặc bằng chứng cùng workspace
- When mã gọi `knowledge.link` / `unlink`
- Then gắn lại là lũy đẳng (`created: false`); một nguồn gắn được nhiều dự án; gỡ liên kết không xoá nguồn; xoá nguồn xoá liên kết theo tầng; xoá dự án xoá liên kết và bí danh nhưng giữ nguồn; CHECK của CSDL từ chối liên kết không có đích hoặc có hai đích

### AC-06 — Hồ sơ, dòng thời gian và sổ quyết định của dự án

- Given dự án có nguồn gắn trực tiếp và qua hội thoại
- When mở trang dự án hoặc ghi quyết định (bắt buộc chọn một bằng chứng của dự án làm nguồn, có thể thay một quyết định đang hiệu lực)
- Then hồ sơ dựng bằng mã (không AI): bí danh, số hội thoại, số bằng chứng, hoạt động gần nhất, quyết định đang hiệu lực; dòng thời gian gộp hai cách gắn, mỗi mục một lần, mới nhất trước, trang hiện 50 mục và phân trang keyset; quyết định mặc định lấy thời điểm của nguồn; thay thế làm cái cũ thành `superseded` trỏ cái mới (luôn còn đúng một cái hiệu lực trong chuỗi); xoá nguồn giữ quyết định nhưng đánh dấu mất nguồn, còn nhãn nguồn

### AC-07 — Tìm kiếm có dấu hoặc không dấu

- Given kho bằng chứng có tin nhắn và tài liệu
- When thành viên gõ từ khoá ở trang Tìm kiếm (≤ 200 ký tự, chế độ "Mọi từ" hoặc "Một trong các từ")
- Then tìm toàn văn trên văn bản đã bỏ dấu (kể cả đ/Đ), không phân biệt hoa thường, khớp tiền tố; "Mọi từ" đòi đủ các từ, "Một trong các từ" bỏ từ dừng; xếp theo độ khớp rồi mới hơn trước; `limit` kẹp 1..50 (trang dùng 20); đoạn trích lấy từ nguyên văn có dấu quanh chỗ khớp; truy vấn rỗng, chỉ dấu câu hay ký tự đặc biệt của tsquery trả rỗng, không lỗi; lọc được theo dự án (gắn trực tiếp hoặc qua hội thoại)

### AC-08 — Hộp chờ phân loại và gợi ý dự án (tầng dịch vụ)

- Given bằng chứng chưa gắn dự án nào (trực tiếp hoặc qua hội thoại)
- When mã gọi `knowledge.inbox` hoặc `knowledge.suggest`
- Then hộp chờ liệt kê mục chưa gắn, mới nhất trước, phân trang keyset, `limit` kẹp 1..100; gợi ý so tên/bí danh nguyên từ (không phân biệt hoa thường, ký tự regex là chữ thường), nhiều dự án cùng khớp là `ambiguous`; chỉ đề xuất, không tự gắn; nội dung chứa chỉ thị chỉ là dữ liệu để so khớp

### AC-09 — Quyền và cô lập workspace (ca lỗi)

- Given member, người ngoài, hoặc ID dự án/bí danh/nguồn/bằng chứng của workspace khác hay không phải UUID; con trỏ hỏng
- When nhập tài liệu, tạo/sửa dự án, gắn nguồn, ghi quyết định, tìm kiếm hoặc đọc dòng thời gian
- Then member chỉ đọc (nhập, tạo, gắn, ghi quyết định bị `ForbiddenError`; trang ẩn form và nói rõ); người ngoài bị `ForbiddenError`; ID không thuộc workspace là `NotFoundError`; con trỏ hỏng là `ValidationError`; tìm kiếm không bao giờ trả mục của workspace khác

## 3. Ca biên

| Nhóm                  | Ca cụ thể                                                                     | Hành vi mong đợi                                                          | AC                         |
| --------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------- |
| Rỗng/null             | tài liệu rỗng; tên dự án chỉ khoảng trắng; truy vấn rỗng; dự án chưa có nguồn | từ chối; từ chối; trả rỗng; hồ sơ 0 nguồn, không hoạt động                | AC-03, AC-04, AC-06, AC-07 |
| Cực đại/độ dài        | nội dung > 5 MiB; tên 101 ký tự; 201 dự án; 21 bí danh; `limit` 999           | từ chối (đúng trần nhận); `project_limit`/`alias_limit`; kẹp 50/100       | AC-03, AC-04, AC-07, AC-08 |
| Trùng lặp/idempotency | nhập lại cùng tài liệu; gắn lại cùng nguồn; tên trùng khác hoa thường/NFD     | không tạo thêm; `created: false`; `name_taken`                            | AC-02, AC-04, AC-05        |
| Song song             | hai người cùng thay một quyết định; nhập và dọn blob mồ côi cùng hash         | một người thắng, người kia `decision_not_active`; khoá advisory theo hash | AC-01, AC-06               |
| Mất mạng giữa chừng   | lỗi ghi kho nội dung; lỗi CSDL sau khi ghi tệp                                | không còn dòng DB nào; tệp mồ côi vô hại, không ai trỏ tới                | AC-03                      |
| Thời gian/múi giờ     | nhiều mục trùng thời điểm khi phân trang; ngày quyết định hỏng                | keyset (thời điểm, id) không sót không lặp; `ValidationError`             | AC-06, AC-08               |
| Quyền                 | member ghi; người ngoài; ID workspace khác                                    | Forbidden / NotFound                                                      | AC-09                      |
| Tiền/đơn vị           | —                                                                             | không áp dụng — tính năng không xử lý tiền hay đơn vị đo                  | —                          |

## 4. Dữ liệu

| Thực thể                      | Trường                                                                                        | Kiểu             | Ràng buộc                                                     | Ai đọc/ghi                    |
| ----------------------------- | --------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------- | ----------------------------- |
| `evidence_blobs`              | `sha256`, `size_bytes`, `content_type`                                                        | text/int         | UNIQUE (workspace, sha256); CHECK hash 64 hex, kích thước > 0 | `evidence.write`/hệ thống ghi |
| `evidence_items`              | `source`, `external_id`, `observed_at`, `message_id`                                          | text/timestamptz | UNIQUE (workspace, nguồn, id ngoài, blob)                     | thành viên đọc                |
| `search_documents`            | `text_folded`                                                                                 | text             | một dòng mỗi bằng chứng, cascade                              | ghi cùng giao dịch nhập       |
| `projects`, `project_aliases` | `name`/`alias`, `name_key`/`alias_key`                                                        | text             | UNIQUE theo workspace và khoá so khớp                         | `projects.write` ghi          |
| `project_links`               | `target_type`, `conversation_id`, `evidence_item_id`                                          | uuid             | đúng một đích (CHECK), cascade theo nguồn và dự án            | `projects.write` ghi          |
| `decisions`                   | `text`, `status`, `decided_at`, `source_evidence_item_id`, `source_label`, `superseded_by_id` | text/timestamptz | nguồn SET NULL khi xoá, giữ nhãn                              | `projects.write` ghi          |

## 5. Giao diện / API

- `/app/<workspace>/documents`: nhập tài liệu (admin/owner), danh sách dự án kèm bí danh, tạo dự án, thêm/xoá bí danh.
- `/app/<workspace>/projects/<id>`: hồ sơ, bí danh, sổ quyết định (form ghi khi có ít nhất một bằng chứng), dòng thời gian 50 mục.
- `/app/<workspace>/search?q=…&match=all|any`: tìm kiếm (GET, tham số lạ rơi về mặc định).
- Chỉ ở tầng dịch vụ, giao diện chưa có: gắn/gỡ liên kết (`link`/`unlink`), hộp chờ phân loại (`inbox`), gợi ý dự án (`suggest`), danh sách liên kết. Hiện chưa có nơi nào trong `app/` hay job gọi `link`, nên qua giao diện dòng thời gian của dự án luôn rỗng và form ghi quyết định chỉ hiện lời nhắc "Cần ít nhất một bằng chứng thuộc dự án" — hành vi đúng như mã, không phải lỗi hiển thị.

## 6. Lỗi

| Mã lỗi                          | Khi nào                                | HTTP/exit code                     | Thông điệp cho người dùng       | AC           |
| ------------------------------- | -------------------------------------- | ---------------------------------- | ------------------------------- | ------------ |
| `validation`                    | nội dung/tên/ngày/con trỏ không hợp lệ | `ValidationError`                  | thông điệp cụ thể               | AC-03, AC-09 |
| `integrity`                     | nội dung đọc lại lệch hash             | `IntegrityError`                   | không hiển thị nội dung         | AC-03        |
| `name_taken` / `alias_taken`    | trùng tên hoặc bí danh                 | `ConflictError`                    | thông điệp cụ thể               | AC-04        |
| `project_limit` / `alias_limit` | vượt 200 dự án / 20 bí danh            | `ConflictError`                    | thông điệp cụ thể               | AC-04        |
| `decision_not_active`           | thay quyết định đã bị thay             | `ConflictError`                    | thông điệp cụ thể               | AC-06        |
| `forbidden` / `not_found`       | thiếu quyền, người ngoài / ID lạ       | `ForbiddenError` / `NotFoundError` | không có quyền / không tìm thấy | AC-09        |

## 7. Yêu cầu phi chức năng của tính năng

| Thuộc tính | Ngưỡng                                 | Nguồn        | Cách đo                                            |
| ---------- | -------------------------------------- | ------------ | -------------------------------------------------- |
| Toàn vẹn   | 0 lần trả nội dung lệch hash           | ADR-0004     | `tests/evidence/service.test.ts`                   |
| Tìm kiếm   | bộ đo truy xuất 50 câu (D-014)         | D-014, D-028 | `tests/eval/qa.test.ts`                            |
| Bảo mật    | 0 mục của workspace khác trong kết quả | R-001        | `tests/search/service.test.ts`, `tests/knowledge/` |

## 8. Hành vi AI

- Không gọi model. Gợi ý dự án và hồ sơ dự án dựng bằng mã từ dữ liệu có nguồn; nội dung tài liệu/tin là dữ liệu không tin cậy, chỉ dùng để so khớp và hiển thị đã escape. Hỏi đáp AI trên kho này thuộc F-008.

## 9. Đo lường

- Chưa có chỉ số sản phẩm riêng; chất lượng truy xuất đo bằng bộ câu ở `tests/eval/`.

## 10. Câu hỏi mở

- [x] Định dạng tài liệu nhập? — [không chặn] — Đã quyết: D-013 (phiên chính, 2026-11-22) — văn bản/Markdown; PDF (Docling) để đợt sau.
- [x] Công cụ tìm kiếm? — [không chặn] — Đã quyết: D-014 (phiên chính, 2026-11-22) — toàn văn dựng sẵn của Postgres trên văn bản đã bỏ dấu, chưa dùng pg_trgm.
- [x] Liên kết, hộp chờ phân loại, gợi ý chưa có giao diện thì spec ghi thế nào? — [không chặn] — Đã quyết: D-041 (phiên chính, 2026-11-24) — spec theo hành vi thật: ghi là tầng dịch vụ (AC-05, AC-08, mục 5), không hứa nút bấm.

## 11. DoR / DoD

- DoR: spec Approved · 0 câu hỏi chặn · phụ thuộc rõ · đủ nhỏ cho một PR · mỗi task có Gate.
- DoD: mọi AC có test chứa `F-007/AC-xx` và xanh · ca biên có test · cổng xanh · blueprint tick có bằng chứng.

## 12. Truy vết

| AC    | Test (tên chứa `F-007/AC-xx`)                                                                                                                                                |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01 | `tests/evidence/service.test.ts`, `tests/search/service.test.ts`, `e2e/documents.spec.ts`                                                                                    |
| AC-02 | `tests/evidence/service.test.ts`, `tests/search/service.test.ts`                                                                                                             |
| AC-03 | `tests/evidence/service.test.ts`                                                                                                                                             |
| AC-04 | `tests/knowledge/service.test.ts`                                                                                                                                            |
| AC-05 | `tests/knowledge/service.test.ts`                                                                                                                                            |
| AC-06 | `tests/knowledge/decisions.test.ts`, `tests/knowledge/timeline.test.ts`                                                                                                      |
| AC-07 | `tests/search/service.test.ts`, `e2e/search.spec.ts`                                                                                                                         |
| AC-08 | `tests/knowledge/inbox.test.ts`                                                                                                                                              |
| AC-09 | `tests/knowledge/service.test.ts`, `tests/knowledge/timeline.test.ts`, `tests/knowledge/decisions.test.ts`, `tests/evidence/service.test.ts`, `tests/search/service.test.ts` |

- Task: đợt xw-2, xw-3 (D-013, D-014), spec bù theo D-041 · Kiểm: `npx vitest run tests/config/specs.test.ts`.

## Thay đổi

| Phiên bản | Ngày       | Gì                        | Vì sao                                  | Duyệt |
| --------- | ---------- | ------------------------- | --------------------------------------- | ----- |
| 1         | 2026-11-24 | tạo spec bù theo mã đã có | AUD-HAR-013: tính năng có mã, chưa spec | D-041 |
