# docs/autopilot/PLAN-xw-2.md — X-Workspace · Đợt xw-2 (kho bằng chứng)

> Duyệt: D-013 (phiên chính tự duyệt) · Kế hoạch: docs/work/2026-11-22-x-workspace-plan/working.md §4–5 · ADR-0002, ADR-0004 · Blueprint: BLUEPRINT.md

## Mục tiêu của kế hoạch này

Mọi nguồn (tin nhắn, GitHub, tài liệu) đi vào một kho bản gốc theo hash, gắn được vào dự án, dựng được dòng thời gian và
xoá/xuất xuyên mọi lớp dẫn xuất. Chỉ số: các ca trong Gate xanh trên PGlite; không lớp nào đọc được dữ liệu của
workspace khác; cùng nội dung nhập hai lần chỉ có một bản lưu.

## Ngân sách (4 con số)

- Số vòng tối đa: 60
- Ngân sách: theo phiên
- Timeout mỗi lệnh Gate: 300 giây
- Ngày hết hạn: 2026-11-30T00:00:00Z

## Hạn

| Loại          | Ngày       | Hậu quả nếu trễ | Cách xử lý khi trễ     |
| ------------- | ---------- | --------------- | ---------------------- |
| Hạn mong muốn | 2026-11-30 | nội bộ          | re-plan, không hạ cổng |

## Ủy quyền production

- grant: payments | mode=sandbox | max_per_txn=0 | refund=false
- grant: data_delete | hard_delete=false | max_rows=100
- grant: data_export | pii=false | max_rows=10000
- grant: outbound_messages | live=false | max_per_hour=0
- grant: auth_crypto | custom_crypto=false
- grant: secrets | read_values=false

## Điểm dừng bắt buộc về hành động

- Token GitHub thật, khoá AI/SocialAPI thật, dịch vụ trả phí: `loop defer`
- Xoá agent, lệnh, hook cũ: người làm (T-108)
- Merge PR chạm dữ liệu người dùng khi `merge_hard_exceptions: human`: người merge

## Thứ tự & lý do

1. Lát 1 — kho bản gốc: mọi lớp sau trích dẫn vào đây.
2. Lát 2 — dự án và liên kết: nhóm bằng chứng thành ngữ cảnh làm việc.
3. Lát 3 — dòng thời gian, độ bao phủ, xuất và xoá: dùng được và tuân thủ.
4. Lát 4 — connector GitHub: nguồn thứ hai, dùng cổng `fetch` tiêm được (kiểm bằng fixture, token thật `defer`).

Phạm vi cắt có chủ đích (D-013): tài liệu nhập vào là văn bản thuần/Markdown; PDF/scan (Docling) là đợt sau vì cần
runtime Python riêng và quota tài nguyên (working.md §2, research §2).

## Task

### Lát 1 — Kho bản gốc (M04)

- [x] `T-201` Kho bản gốc theo hash: bảng `evidence_blobs` (sha256 duy nhất theo workspace, kích thước, loại) và `evidence_items` (mỗi lần nhập: nguồn, id ngoài, thời điểm nhập, tham chiếu blob) — migration 0010 + down; cổng `BlobStore` (bản thư mục theo `sha256`, bản bộ nhớ cho test); dịch vụ `ingest` kiểm quyền. Given cùng nội dung nhập hai lần When ingest Then một blob, hai lần xuất hiện; ca biên: nội dung rỗng, trần kích thước, hash lệch khi đọc lại bị phát hiện, workspace khác không thấy blob, blob ghi dở (lỗi giữa chừng) không để lại mục mồ côi (files: src/evidence/, src/db/schema.ts, drizzle/, PROJECT.md, tests/evidence/, tests/db/; exec: deep) — Gate: `npx vitest run tests/evidence tests/db tests/config/data-classification.test.ts`
- [x] `T-202` Nhập tin nhắn vào kho: mỗi tin mới trong `messages` có một `evidence_item` (nguồn `message`) tham chiếu nội dung nguyên văn; đồng bộ lại không nhân đôi. Given tin được đồng bộ và nhận qua webhook When ingest Then đúng một bằng chứng cho tin đó (sau: T-201; files: src/evidence/, src/conversations/, src/inbox/, tests/evidence/, tests/conversations/) — Gate: `npx vitest run tests/evidence tests/conversations tests/inbox`

### Lát 2 — Dự án và liên kết (M06)

- [x] `T-203` Dự án, bí danh, liên kết nguồn–dự án (migration 0011 + down): owner/admin tạo dự án, thêm bí danh (so khớp NFC + không phân biệt hoa thường), gắn hội thoại/bằng chứng vào dự án. Ca biên: trùng bí danh trong workspace bị từ chối, member chỉ đọc, gỡ liên kết không xoá bằng chứng (sau: T-201; files: src/knowledge/, src/db/schema.ts, drizzle/, src/auth/permissions.ts, tests/knowledge/, tests/auth/; exec: deep) — Gate: `npx vitest run tests/knowledge tests/auth tests/db`
- [x] `T-204` Hộp chờ phân loại: bằng chứng chưa gắn dự án vào hộp chờ; gợi ý gắn theo bí danh xuất hiện trong nội dung (chỉ đề xuất, người xác nhận). Ca biên: nhiều dự án cùng khớp là mơ hồ, không tự gắn; nội dung không có bí danh nằm lại hộp chờ (sau: T-203; files: src/knowledge/, tests/knowledge/) — Gate: `npx vitest run tests/knowledge`

### Lát 3 — Dòng thời gian, độ bao phủ, xuất và xoá (M07, M12)

- [x] `T-205` Dòng thời gian của dự án: bằng chứng và tin nhắn đã liên kết sắp theo thời gian, phân trang keyset, lọc theo quyền workspace. Ca biên: trùng thời điểm không sót/lặp qua trang, dự án rỗng, người ngoài bị Forbidden (sau: T-203; files: src/knowledge/, tests/knowledge/) — Gate: `npx vitest run tests/knowledge`
- [x] `T-206` Độ bao phủ nguồn: `source_checkpoints` (con trỏ, lần chạy cuối, lỗi cuối dạng mã an toàn) cho từng tài khoản/nguồn; màn hình/dịch vụ báo nguồn nào đã đồng bộ tới đâu và hội thoại nào còn lịch sử chưa lấy. Ca biên: chưa chạy lần nào, lỗi liên tiếp, nhiều nguồn (sau: T-201; files: src/conversations/, src/evidence/, src/db/schema.ts, drizzle/, tests/) — Gate: `npx vitest run tests/conversations tests/evidence tests/db`
- [x] `T-207` Xoá và xuất xuyên lớp: xoá theo hội thoại/nguồn/dự án đi qua bằng chứng, liên kết, tin nhắn, mục hộp thư, blob không còn tham chiếu; xuất JSON của một dự án (không kèm bí mật). Ca biên: blob còn được workspace khác dùng không xoá, lũy đẳng, trần số dòng theo grant `data_delete`, xuất không chứa khoá/chữ ký (sau: T-205, T-206; files: src/retention/, src/evidence/, src/knowledge/, tests/; exec: deep) — Gate: `npx vitest run tests/retention tests/evidence tests/knowledge`

### Lát 4 — Connector GitHub (M07)

- [ ] `T-208` Connector GitHub nhập issue, PR, review theo con trỏ: cổng `GithubPort` (fetch tiêm được), phân trang `Link`/`since`, giới hạn tốc độ (`403/429` + `retry-after`/`x-ratelimit-reset`), nhập vào kho với id ngoài `owner/repo#số`. Ca biên: lặp lại không nhân đôi, issue bị sửa tạo phiên bản mới, hết hạn mức dừng có mã `rate_limited` không đốt thêm lượt, token không vào log/lỗi (sau: T-201; files: src/connectors/github/, src/evidence/, tests/connectors/; exec: deep) — Gate: `npx vitest run tests/connectors tests/evidence`

### Việc cần người

- [ ] `T-209` Token GitHub chỉ đọc cho repo pilot để thử connector thật — cần người: khoá thật (sau: T-208; files: không có) — Gate: `npx vitest run tests/connectors`
- [ ] `T-009` Tạo `.env.example` (BASE-CFG-003) — cần người: quy tắc quyền chặn ghi `.env*` (D-004) (files: .env.example, tests/config/env-example.test.ts) — Gate: `npx vitest run tests/config/env-example.test.ts`
- [ ] `T-108` Gỡ 8 tệp hook cũ, 10 agent và 13 lệnh cũ của projects-template — cần người (ADR-0003) (files: .claude/hooks/, .claude/agents/, .claude/commands/) — Gate: `npx vitest run tests/config/process-tooling.test.ts`

## Phụ thuộc ngoài

| Việc                                 | Bên ngoài | Ngày cam kết | Kế hoạch B                           |
| ------------------------------------ | --------- | ------------ | ------------------------------------ |
| Token GitHub chỉ đọc cho repo pilot  | chủ dự án | không có     | fixture theo tài liệu REST, `defer`  |
| Khoá SocialAPI thật + kênh thử (M02) | chủ dự án | không có     | fixture theo tài liệu, demo provider |
