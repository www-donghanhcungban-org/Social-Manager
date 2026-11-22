# PROGRESS.md — Social Manager

> Giai đoạn hiện tại: G2 Kế hoạch · Cập nhật: 2026-11-22 02:10 UTC · Nhánh: claude/modest-dirac-r68f0l

## Đang làm

- Gộp khung X-Templates làm bộ chính — trạng thái: chờ người xoá 2 file `*.xtemplates-new` trong thư mục hook rồi chạy `xt.py doctor` — chỗ dừng: `doctor` còn 1 lỗi

## Tiếp theo

1. ADR stack (phiên bản xác minh 2026-11-22: next 16.4.6, react 19.3.1, drizzle-orm 0.45.4, pg 8.23.1, pg-boss 12.39.0, better-auth 1.7.27, zod 4.6.7) và `PLAN.md` đợt 0
2. Đợt 0 còn lại: schema Postgres + migration, đăng nhập/workspace, kho khoá mã hoá, hành động của provider (đăng bài, đọc hộp thư) kèm test hợp đồng chạy trên mọi provider
3. `BLUEPRINT.md` đã ghép (510 MUST, chưa đạt mục nào): tick dần kèm lệnh kiểm
4. Đã xong: lớp provider cắm được (`src/providers/`: registry, SocialAPI, demo) — 9 test xanh

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
