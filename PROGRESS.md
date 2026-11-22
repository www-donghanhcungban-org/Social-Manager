# PROGRESS.md — Social Manager

> Giai đoạn hiện tại: G2 Kế hoạch · Cập nhật: 2026-11-22 02:10 UTC · Nhánh: claude/modest-dirac-r68f0l

## Đang làm

- Gộp khung X-Templates làm bộ chính — trạng thái: chờ người xoá 2 file `*.xtemplates-new` trong thư mục hook rồi chạy `xt.py doctor` — chỗ dừng: `doctor` còn 1 lỗi

## Tiếp theo

1. Compose `BLUEPRINT.md` (web-app, quy mô M) và `PLAN.md` đợt 0 theo `docs/work/2026-11-22-social-manager-plan/working.md` (Gate: `python3 .xtemplates/scripts/xt.py blueprint-status BLUEPRINT.md`)
2. Đợt 0: ADR stack, schema, đăng nhập, adapter nguồn dữ liệu (cắm nhiều nhà cung cấp)
3. Cổng sắp tới: G3 — còn thiếu: BLUEPRINT, PLAN, ADR stack

## Quyết định

- 2026-11-22 X-Templates là bộ khung chính; bộ projects-template gỡ dần — lý do: người dùng chọn
- 2026-11-22 Web tự host, nguồn dữ liệu mạng xã hội cắm được nhiều nhà cung cấp (SocialAPI là adapter đầu), hỗ trợ nhiều người dùng — lý do: người dùng chọn
- Nợ kỹ thuật chấp nhận: hook, agent và script cũ của projects-template còn trong repo (guard chặn gỡ qua Bash) — hạn trả: đợt 0

## Bàn giao phiên

- Commit cuối trên nhánh chính: `013939e44a0abbb02740128216dcc879f125d0c3` · CI: chưa chạy
- Lệnh kiểm nhanh: `python3 .xtemplates/scripts/xt.py doctor --offline` → exit 1 (1 lỗi: 2 file `*.xtemplates-new` trong thư mục hook)
- Đang chặn: guard chặn xoá file trong thư mục hook, `.cursor`, agent cũ qua Bash
- Việc dở chưa commit: không
- Câu hỏi cần người: không
