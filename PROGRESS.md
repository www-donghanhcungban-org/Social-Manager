# PROGRESS.md — Social Manager

> Giai đoạn hiện tại: G6 Build — đợt 0–2 xong phần lớn (T-001..T-038, trừ T-009), PR #18 đang chờ CI/người merge · Cập nhật: 2026-11-22 · Nhánh: claude/modest-dirac-r68f0l

## Đang làm

- PR #18 (nhánh → main): chờ CI `gate` + `e2e` xanh trên runner thật; `gitleaks` đã sửa và xanh. Merge là việc của người (ngoại lệ cứng, `pr next` → DEFER-HUMAN)

## Tiếp theo

1. Còn ~462 MUST mở (`xt.py blueprint-status BLUEPRINT.md --json`): BASE-DEP-004 (osv-scanner), BASE-SEC-002 (gitleaks đã xanh trên CI, còn khoản xoay khoá/pre-commit), BASE-GATE-005/006, BASE-CFG-008, PRF-WEB-001/002, nhóm UX còn lại (A11Y-002/003/011, STATE, CONTENT, DS)
2. Tính năng chưa có: trả lời tin từ hộp thư (cần tra tài liệu SocialAPI về endpoint trả lời, không đoán), tự động trả lời AI, thống kê/CRM, PWA, i18n
3. CI nên chạy cả hai project Playwright (desktop + mobile) và có dịch vụ Postgres cho e2e (hiện e2e CI chạy không DB nên các spec cần DB bị bỏ qua)
4. Sau mỗi lát: mở PR nhỏ riêng (không dồn nữa)

## Quyết định

- D-001..D-008 ở `docs/autopilot/DECISIONS.md` (mới: D-006 tắt cacheComponents vì xung đột nonce CSP, D-007 Argon2id bằng hash-wasm, D-008 thêm devDependency @axe-core/playwright)
- 2026-11-22 X-Templates là bộ khung chính (D-001; ADR-0001 chốt stack) — lý do: người dùng chọn
- Nợ kỹ thuật chấp nhận: hook, agent và script cũ của projects-template còn trong repo (guard chặn gỡ qua Bash) — hạn trả: khi người dùng cho phép gỡ
- Nợ kỹ thuật chấp nhận: esbuild moderate qua drizzle-kit (`docs/ops-notes/dependency-exceptions.md`, hạn 2027-02-22); `.gitleaks.toml` miễn hẹp cho chuỗi giả trong test
- Chưa xác minh: SocialAPI chưa thử với khoá thật, giả định `data.account_id` = `external_id` (THREAT-MODEL §6); Docker image chưa build (môi trường làm việc không có daemon); test e2e chập chờn một lần (`toHaveCount`, chưa rõ spec nào)

## Bàn giao phiên

- Commit cuối trên nhánh chính: `d9ebc747571851188983b14945133d86251cd482` · CI: PR #18 đang chạy (`merge_autonomy: L1`, người merge)
- Lệnh kiểm nhanh: `.xtemplates/scripts/dev-task.sh gate-fast` → xanh ở commit cuối (425 test); Playwright 54/54 trên Postgres thật bằng script e2e cục bộ
- Đang chặn: T-009 `.env.example` — quy tắc quyền chặn ghi file, cần người tạo hoặc cấp quyền
- Việc dở chưa commit: không
- Câu hỏi cần người: merge PR #18 khi CI xanh; tạo `.env.example`
