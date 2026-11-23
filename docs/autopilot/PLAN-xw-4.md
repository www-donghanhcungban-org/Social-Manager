# docs/autopilot/PLAN-xw-4.md — X-Workspace · Đợt xw-4 (hành động có kiểm soát)

> Duyệt: D-015 (phiên chính tự duyệt, chủ dự án giao toàn quyền) · Kế hoạch: docs/work/2026-11-22-x-workspace-plan/working.md §2 (H3, H12, H13, H14), §4–5 · ADR-0002, ADR-0006 · Blueprint: BLUEPRINT.md

## Mục tiêu của kế hoạch này

Trả lời khách từ hộp thư theo cách KHÔNG BAO GIỜ gửi trùng hoặc gửi ngoài phạm vi: bản nháp có phiên bản, chính sách bằng mã
(người nhận, cửa sổ nhắn tin, độ dài, hạn mức), sổ hành động bền, `send_unknown` thay cho thử lại mù, đối soát bằng cách đọc
lại tin gửi đi. Chỉ số: các ca trong Gate xanh trên nhà cung cấp giả; không đường nào gửi hai lần cùng một yêu cầu.

## Ngân sách (4 con số)

- Số vòng tối đa: 60
- Ngân sách: theo phiên
- Timeout mỗi lệnh Gate: 300 giây
- Ngày hết hạn: 2026-12-10T00:00:00Z

## Hạn

| Loại          | Ngày       | Hậu quả nếu trễ | Cách xử lý khi trễ     |
| ------------- | ---------- | --------------- | ---------------------- |
| Hạn mong muốn | 2026-12-10 | nội bộ          | re-plan, không hạ cổng |

## Ủy quyền production

- grant: payments | mode=sandbox | max_per_txn=0 | refund=false
- grant: data_delete | hard_delete=false | max_rows=100
- grant: data_export | pii=false | max_rows=10000
- grant: outbound_messages | live=false | max_per_hour=0
- grant: auth_crypto | custom_crypto=false
- grant: secrets | read_values=false

## Điểm dừng bắt buộc về hành động

- Gửi tin thật tới người thật (`outbound_messages live=false`): mọi đường gửi mặc định TẮT; bật gửi thật là việc của chủ dự án
  (`OUTBOUND_LIVE=true` và `workspaces.outbound_enabled` do owner bật) — tác tử không bật và không thử gửi thật
- Khoá SocialAPI/AI/GitHub thật: `loop defer`
- Xoá agent, lệnh, hook cũ: người làm (T-108)

## Thứ tự & lý do

1. Lát 1 — bản nháp có phiên bản: nền để người duyệt đúng nội dung sẽ gửi.
2. Lát 2 — hợp đồng gửi của nhà cung cấp: tách việc gửi khỏi dịch vụ, nhà cung cấp giả để kiểm.
3. Lát 3 — chính sách và sổ hành động: mọi lần gửi đi qua một cửa, lũy đẳng, thất bại đóng.
4. Lát 4 — `send_unknown`, đối soát, huỷ: không gửi lại mù.
5. Lát 5 — job nền và cấu hình: chạy dần, tắt mặc định.

## Task

### Lát 1 — Bản nháp (M09)

- [x] `T-401` Bản nháp có phiên bản cho một hội thoại (migration 0018 + down): `drafts`, `draft_versions` (số phiên bản tăng dần, nguồn `human`/`ai`, người sửa); sửa nháp tạo phiên bản mới không ghi đè; hủy nháp; đọc lịch sử. Ca biên: hai người sửa cùng lúc (xung đột phiên bản, không mất bản nào), nháp rỗng, quá dài, hội thoại workspace khác, nháp đã gửi không sửa được, member được soạn (quyền `inbox.reply`) (files: src/actions/, src/db/schema.ts, drizzle/, tests/actions/, tests/db/; exec: deep) — Gate: `npx vitest run tests/actions tests/db`

### Lát 2 — Hợp đồng gửi (M09, H3)

- [x] `T-402` Hợp đồng `sendMessage` của nhà cung cấp: `SocialProvider.sendMessage`, wrapper kiểm hỗ trợ `dm`; SocialAPI theo `POST /inbox/conversations/{id}/messages` (`account_id`, `text`), phản hồi `message_ids` (Zalo trả rỗng); phân loại lỗi: 4xx từ chối chắc chắn, 5xx/timeout/mạng/phản hồi sai là KHÔNG CHẮC; nhà cung cấp giả. Ca biên: phản hồi `success` không có id, `window_closed`, khoá lộ trong lỗi, mã lỗi lạ (files: src/providers/, tests/providers/) — Gate: `npx vitest run tests/providers`

### Lát 3 — Chính sách và sổ hành động (M09, H3, H12, H13, H14)

- [x] `T-403` Chính sách gửi và sổ hành động (migration 0019 + down): `action_ledger` (trạng thái `queued`, `dispatching`, `confirmed`, `send_unknown`, `blocked`, `failed`, `cancel_requested`, `cancelled`; khoá lũy đẳng theo workspace; băm nội dung; người nhận suy ra từ hội thoại), cột chính sách trên workspace (`outbound_enabled` mặc định tắt, `outbound_max_per_hour`); `requestSend` chạy chính sách (cờ gửi thật, cờ workspace, cửa sổ nhắn tin 24 giờ Messenger/Instagram và 7 ngày Zalo, độ dài theo nền tảng, hạn mức giờ) rồi xếp hàng; `dispatch` nhận việc bằng cập nhật có điều kiện và gọi nhà cung cấp một lần. Ca biên: gửi lại cùng khoá không tạo hành động thứ hai, hai dispatch song song chỉ một thắng, bị chặn thì có bản ghi lý do, nháp đã gửi, member không đổi chính sách, quá hạn mức đúng biên (sau: T-401, T-402; files: src/actions/, src/db/schema.ts, drizzle/, src/auth/, tests/actions/, tests/db/, PROJECT.md; exec: deep) — Gate: `npx vitest run tests/actions tests/db tests/config`

### Lát 4 — Không gửi lại mù (M11, H3)

- [x] `T-404` `send_unknown`, đối soát và huỷ: mất phản hồi sau khi gửi → `send_unknown` (không tự thử lại); `reconcile` đọc lại tin gửi đi của hội thoại và so băm nội dung trong cửa sổ thời gian → `confirmed` nếu thấy; không thấy thì giữ `send_unknown` kèm kết quả đối soát; người (admin/owner) quyết `resolveUnknown` (`sent`/`not_sent`) — chỉ `not_sent` mở đường cho một yêu cầu MỚI; `cancel`: `queued`→`cancelled`, `dispatching`→`cancel_requested`. Ca biên: tin cùng nội dung có từ trước lúc gửi không bị nhận nhầm, đối soát lỗi mạng, huỷ khi đã `confirmed`, mọi đường không gọi `sendMessage` lần hai (sau: T-403; files: src/actions/, tests/actions/; exec: deep) — Gate: `npx vitest run tests/actions`

### Lát 5 — Chạy nền và cấu hình (M11)

- [ ] `T-405` Job nền `actions.dispatch` và `actions.reconcile`, cờ `OUTBOUND_LIVE` (mặc định tắt), nối container; khi cờ tắt việc đã xếp hàng giữ nguyên, không gửi. Ca biên: job lỗi không mất hành động, cờ tắt giữa chừng, trần lô, đăng ký lịch (sau: T-404; files: src/jobs/, src/config/env.ts, src/server/container.ts, tests/jobs/, tests/config/) — Gate: `npx vitest run tests/jobs tests/config tests/server`

### Việc cần người

- [ ] `T-009` Tạo `.env.example` (BASE-CFG-003), gồm `BLOB_DIR`, `AI_*`, `OUTBOUND_LIVE` — cần người: quy tắc quyền chặn ghi `.env*` (D-004) (files: .env.example, tests/config/env-example.test.ts) — Gate: `npx vitest run tests/config/env-example.test.ts`
- [ ] `T-108` Gỡ 8 tệp hook cũ, 10 agent và 13 lệnh cũ của projects-template — cần người (ADR-0003) (files: .claude/hooks/, .claude/agents/, .claude/commands/) — Gate: `npx vitest run tests/config/process-tooling.test.ts`
- [ ] `T-406` Bật gửi thật: thử trên một kênh thật với khoá SocialAPI thật, kiểm hình dạng phản hồi gửi, tên mã `window_closed` thật, rồi đặt `OUTBOUND_LIVE=true` — cần người: khoá thật, tin tới người thật, `outbound_messages live=false` (sau: T-405; files: không có) — Gate: `npx vitest run tests/actions`

## Phụ thuộc ngoài

| Việc                                   | Bên ngoài | Ngày cam kết | Kế hoạch B                                      |
| -------------------------------------- | --------- | ------------ | ----------------------------------------------- |
| Khoá SocialAPI thật + kênh thử (T-406) | chủ dự án | không có     | nhà cung cấp giả theo hợp đồng; gửi thật tắt     |
| Mô hình AI thật (T-306)                | chủ dự án | không có     | mô hình giả theo `ModelPort`                    |
| Token GitHub chỉ đọc (T-209)           | chủ dự án | không có     | fixture theo tài liệu REST                      |
