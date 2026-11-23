# docs/autopilot/PLAN-xw-4b.md — X-Workspace · Đợt xw-4b (giao diện hội thoại và trả lời)

> Duyệt: D-016 (phiên chính tự duyệt; chủ dự án giao toàn quyền) · Kế hoạch: docs/work/2026-11-22-x-workspace-plan/working.md §5 · ADR-0006 · Blueprint: BLUEPRINT.md

## Mục tiêu của kế hoạch này

Đưa dịch vụ nháp và sổ hành động của xw-4 ra giao diện: xem danh sách hội thoại, đọc một cuộc trò chuyện, soạn nháp, yêu cầu
gửi và theo dõi trạng thái (kể cả `blocked`, `send_unknown`). Gửi thật vẫn TẮT (`OUTBOUND_LIVE`, `outbound_enabled`).

## Ngân sách (4 con số)

- Số vòng tối đa: 40
- Ngân sách: theo phiên
- Timeout mỗi lệnh Gate: 300 giây
- Ngày hết hạn: 2026-12-15T00:00:00Z

## Hạn

| Loại          | Ngày       | Hậu quả nếu trễ | Cách xử lý khi trễ     |
| ------------- | ---------- | --------------- | ---------------------- |
| Hạn mong muốn | 2026-12-15 | nội bộ          | re-plan, không hạ cổng |

## Ủy quyền production

- grant: payments | mode=sandbox | max_per_txn=0 | refund=false
- grant: data_delete | hard_delete=false | max_rows=100
- grant: data_export | pii=false | max_rows=10000
- grant: outbound_messages | live=false | max_per_hour=0
- grant: auth_crypto | custom_crypto=false
- grant: secrets | read_values=false

## Điểm dừng bắt buộc về hành động

- Gửi tin thật: giao diện chỉ yêu cầu gửi; cờ hệ thống và cờ workspace vẫn do người bật, tác tử không bật.

## Task

### Lát 1 — Đọc hội thoại

- [ ] `T-411` Dịch vụ đọc hội thoại: danh sách theo `last_message_at` mới nhất trước (khoá phân trang, cô lập workspace) và một cuộc trò chuyện (tin theo thời gian, nháp, hành động của các nháp). Ca biên: id lạ/workspace khác, hội thoại rỗng, `last_message_at` null, con trỏ hỏng, thành viên ngoài (files: src/conversations/threads.ts, tests/conversations/threads.test.ts) — Gate: `npx vitest run tests/conversations/threads.test.ts`

### Lát 2 — Lời nhắn cho người dùng

- [ ] `T-412` Nhãn tiếng Việt cho trạng thái hành động, lý do bị chặn và lỗi dịch vụ (`describeActionError`: Forbidden, NotFound, Validation, Conflict theo `reason`; lỗi lạ ném lại, không lộ chi tiết). Ca biên: mọi `ACTION_STATES` và `BLOCK_REASONS` đều có nhãn (test chống lệch), `reason` Conflict lạ có lời nhắn chung (sau: T-411; files: src/actions/labels.ts, tests/actions/labels.test.ts) — Gate: `npx vitest run tests/actions/labels.test.ts`

### Lát 3 — Trang hội thoại

- [ ] `T-413` Trang `/app/[workspaceId]/conversations` (danh sách) và `/[conversationId]` (tin, soạn nháp, gửi, trạng thái, huỷ, quyết định `send_unknown`) bằng Server Action; khoá lũy đẳng sinh khi dựng form (bấm đúp không gửi hai lần); trang nói rõ khi gửi đang tắt; thêm liên kết từ điều hướng (sau: T-412; files: app/app/[workspaceId]/conversations/, tests/e2e) — Gate: `npx tsc --noEmit -p . && npx vitest run tests/actions tests/conversations`
