# docs/autopilot/PLAN-xw-3.md — X-Workspace · Đợt xw-3 (tri thức và AI)

> Duyệt: D-014 (phiên chính tự duyệt) · Kế hoạch: docs/work/2026-11-22-x-workspace-plan/working.md §2 (H6, H7, H8, H13), §4–5 · ADR-0002, ADR-0005 · Blueprint: BLUEPRINT.md

## Mục tiêu của kế hoạch này

Hỏi được bằng tiếng Việt (có dấu hoặc không dấu) và nhận câu trả lời có trích dẫn về đúng bằng chứng, mà không để nội dung
ngoài điều khiển hệ thống và không gửi dữ liệu ra ngoài khi chưa được phép. Chỉ số: bộ 50 câu có phiên bản đạt ngưỡng
recall@5 trong Gate; câu trả lời có trích dẫn không hợp lệ bị loại; AI tắt mặc định.

## Ngân sách (4 con số)

- Số vòng tối đa: 60
- Ngân sách: theo phiên
- Timeout mỗi lệnh Gate: 300 giây
- Ngày hết hạn: 2026-12-05T00:00:00Z

## Hạn

| Loại          | Ngày       | Hậu quả nếu trễ | Cách xử lý khi trễ     |
| ------------- | ---------- | --------------- | ---------------------- |
| Hạn mong muốn | 2026-12-05 | nội bộ          | re-plan, không hạ cổng |

## Ủy quyền production

- grant: payments | mode=sandbox | max_per_txn=0 | refund=false
- grant: data_delete | hard_delete=false | max_rows=100
- grant: data_export | pii=false | max_rows=10000
- grant: outbound_messages | live=false | max_per_hour=0
- grant: auth_crypto | custom_crypto=false
- grant: secrets | read_values=false

## Điểm dừng bắt buộc về hành động

- Khoá AI thật hoặc dịch vụ AI trả phí/đám mây thật, token GitHub thật: `loop defer`
- Xoá agent, lệnh, hook cũ: người làm (T-108)
- Merge PR chạm dữ liệu người dùng khi `merge_hard_exceptions: human`: người merge

## Thứ tự & lý do

1. Lát 1 — tìm kiếm: mọi câu trả lời dựa trên truy xuất đúng.
2. Lát 2 — sổ quyết định và hồ sơ dự án: tri thức có cấu trúc, có nguồn, không cần AI.
3. Lát 3 — cổng `ModelPort`, hỏi đáp có trích dẫn, nhật ký dữ liệu gửi đi: AI sau hàng rào.
4. Lát 4 — bộ đánh giá 50 câu có phiên bản chạy trong Gate (đo truy xuất, không đo model).

Phạm vi cắt có chủ đích (D-014): không thêm phụ thuộc `ai` (AI SDK) ở đợt này — adapter OpenAI-tương-thích dùng `fetch`
(Ollama cục bộ, vLLM, dịch vụ tương thích) sau cổng `ModelPort`; thêm adapter AI SDK sau không đổi dịch vụ (ADR-0005). Chưa
có tìm kiếm mờ `pg_trgm` (cần extension ở môi trường thật; chưa cần cho bộ 50 câu).

## Task

### Lát 1 — Tìm kiếm tiếng Việt (M08, H8)

- [x] `T-301` Tìm kiếm toàn văn tiếng Việt có dấu và không dấu: hàm bỏ dấu của dự án (đủ chữ có dấu và `đ/Đ`, 1 ký tự gốc → 1 ký tự), bảng `search_documents` (nội dung đã bỏ dấu, chỉ mục GIN `to_tsvector('simple', …)`), migration 0015 + down; ghi chỉ mục trong cùng giao dịch với nhập bằng chứng; tìm theo tiền tố, lọc theo dự án, chỉ trả mục thuộc workspace; đoạn trích lấy từ nguyên văn. Given nội dung "Khách đặt Cửa hàng Hoa" When tìm "cua hang hoa" hoặc "CỬA HÀNG" Then trúng; ca biên: truy vấn rỗng/chỉ dấu câu, `đ`, tiền tố, ký tự đặc biệt của tsquery không gây lỗi, workspace khác không thấy, mục bị xoá khỏi kết quả, phiên bản cũ của cùng id ngoài (files: src/search/, src/evidence/, src/db/schema.ts, drizzle/, tests/search/, tests/db/; exec: deep) — Gate: `npx vitest run tests/search tests/evidence tests/db`

### Lát 2 — Sổ quyết định và hồ sơ dự án (M08)

- [x] `T-302` Sổ quyết định có hiệu lực (migration 0016 + down): mỗi quyết định thuộc một dự án, bắt buộc dẫn một bằng chứng làm nguồn, có thể thay thế bằng quyết định mới (cái cũ thành `superseded`); hồ sơ dự án dựng bằng mã (bí danh, số nguồn, hoạt động gần nhất, quyết định đang hiệu lực kèm nguồn). Ca biên: thay thế quyết định đã bị thay, nguồn của workspace khác, member chỉ đọc, hai quyết định hiệu lực không mâu thuẫn trạng thái, xoá bằng chứng nguồn giữ quyết định nhưng đánh dấu mất nguồn (sau: T-301; files: src/knowledge/, src/db/schema.ts, drizzle/, src/auth/permissions.ts, tests/knowledge/, tests/auth/, tests/db/; exec: deep) — Gate: `npx vitest run tests/knowledge tests/auth tests/db`

### Lát 3 — AI sau hàng rào (M08, H6, H7, H13)

- [x] `T-303` Cổng `ModelPort` và adapter OpenAI-tương-thích bằng `fetch`: AI tắt mặc định (`AI_BASE_URL` trống), điểm cuối không phải máy cục bộ chỉ chạy khi workspace bật `ai_cloud_enabled` (migration 0017 + down), mỗi lượt gọi ghi `ai_disclosures` (điểm cuối, số mục và byte gửi đi, không ghi nội dung); khoá API là bí mật che trong log. Ca biên: AI chưa cấu hình, điểm cuối cloud khi workspace chưa bật, lỗi mạng/timeout/trả sai, khoá không vào log/lỗi/nhật ký, trần số byte gửi đi (files: src/ai/, src/config/env.ts, src/db/schema.ts, drizzle/, tests/ai/, tests/config/, tests/db/; exec: deep) — Gate: `npx vitest run tests/ai tests/config tests/db`
- [x] `T-304` Hỏi đáp có trích dẫn: truy xuất top-k → đóng khung nguồn là dữ liệu → mô hình trả JSON có schema → mọi trích dẫn phải trỏ đúng nguồn đã đưa vào, không thì từ chối trả lời. Ca biên: không có bằng chứng thì không gọi mô hình, nguồn chứa chỉ thị bị coi là dữ liệu, trích dẫn bịa/ngoài phạm vi bị loại, đầu ra không đúng schema, mô hình không cần quyền ghi, ghi `ai_disclosures` đúng các mục đã gửi (sau: T-301, T-303; files: src/ai/, src/search/, tests/ai/; exec: deep) — Gate: `npx vitest run tests/ai tests/search`

### Lát 4 — Đánh giá có phiên bản

- [ ] `T-305` Bộ 50 câu hỏi có phiên bản (`docs/eval/qa-v1.json`) trên kho giả cố định, đo recall@5 của truy xuất (có dấu và không dấu) trong Gate với ngưỡng ghi trong tệp; thay đổi bộ câu hỏi hoặc ngưỡng cần ghi lý do. Ca biên: câu không có đáp án đúng (phải trả rỗng), cùng từ ở hai dự án (sau: T-301; files: docs/eval/, tests/eval/) — Gate: `npx vitest run tests/eval`

### Việc cần người

- [ ] `T-009` Tạo `.env.example` (BASE-CFG-003), gồm `BLOB_DIR`, `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY` — cần người: quy tắc quyền chặn ghi `.env*` (D-004) (files: .env.example, tests/config/env-example.test.ts) — Gate: `npx vitest run tests/config/env-example.test.ts`
- [ ] `T-108` Gỡ 8 tệp hook cũ, 10 agent và 13 lệnh cũ của projects-template — cần người (ADR-0003) (files: .claude/hooks/, .claude/agents/, .claude/commands/) — Gate: `npx vitest run tests/config/process-tooling.test.ts`
- [ ] `T-306` Thử AI thật (Ollama cục bộ hoặc dịch vụ tương thích) và đối chiếu chất lượng câu trả lời — cần người: mô hình/khoá thật (sau: T-304; files: không có) — Gate: `npx vitest run tests/ai`

## Phụ thuộc ngoài

| Việc                                  | Bên ngoài | Ngày cam kết | Kế hoạch B                                  |
| ------------------------------------- | --------- | ------------ | ------------------------------------------- |
| Mô hình AI thật (Ollama/khoá dịch vụ) | chủ dự án | không có     | mô hình giả theo hợp đồng `ModelPort`, defer |
| Token GitHub chỉ đọc (T-209)          | chủ dự án | không có     | fixture theo tài liệu REST                  |
