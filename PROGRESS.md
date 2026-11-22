# PROGRESS.md — Social Manager

> Giai đoạn hiện tại: G6 Build đợt 0 (đã xong 7/7 task, chờ review độc lập) · Cập nhật: 2026-11-22 02:30 UTC · Nhánh: claude/modest-dirac-r68f0l

## Đang làm

- Review độc lập `reviewer-alt` cho T-003/T-004/T-006/T-007 (`topo: review`) — trạng thái: chờ kết quả — chỗ dừng: sửa 🔴/🟠 nếu có rồi `loop next-step`

## Tiếp theo

1. Đợt 1 (`PLAN-dot1.md`): kết nối tài khoản, đăng bài + lịch, hộp thư DM/bình luận, hàng đợi job (pg-boss), webhook (Gate: `npm test`)
2. Chưa có UI nào: đợt 0 chỉ có lõi (provider, mã hoá, schema, đăng nhập, quyền). Đợt 1 mở đầu bằng khung giao diện + theme
3. `BLUEPRINT.md`: 510 MUST, chưa tick mục nào (mục đã chứng minh bằng test cần tick kèm lệnh kiểm)
4. Cổng sắp tới: G7 — còn thiếu: UI, hàng đợi, deploy (docker compose), tick blueprint

## Quyết định

- 2026-11-22 X-Templates là bộ khung chính (D-001 duyệt PLAN đợt 0; ADR-0001 chốt stack) — lý do: người dùng chọn
- 2026-11-22 D-002 tách T-006 thành quy tắc vai trò (T-006) và nối Better Auth (T-007)
- Nợ kỹ thuật chấp nhận: hook, agent và script cũ của projects-template còn trong repo (guard chặn gỡ qua Bash) — hạn trả: khi người dùng cho phép gỡ
- Nợ kỹ thuật chấp nhận: SocialAPI adapter chỉ đăng bài + DM; `members.user_id` chưa có khoá ngoại tới `user.id` (cả hai có dấu `DEBT:` tại chỗ)

## Bàn giao phiên

- Commit cuối trên nhánh chính: `d9ebc747571851188983b14945133d86251cd482` · CI: chưa chạy (chưa mở PR; `merge_autonomy: L1`, người merge)
- Lệnh kiểm nhanh: `.xtemplates/scripts/dev-task.sh gate` → xanh ở commit cuối của từng task
- Đang chặn: không
- Việc dở chưa commit: không
- Câu hỏi cần người: có mở PR cho nhánh này không (người dùng chưa yêu cầu rõ nên chưa mở)
