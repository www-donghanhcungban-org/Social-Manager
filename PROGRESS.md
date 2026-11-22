# PROGRESS.md — X-Workspace

> Giai đoạn hiện tại: G6 Build — đợt xw-1 (nền X-Workspace, PLAN-xw-1) xong T-101..T-107; T-009, T-108 chờ người · Cập nhật: 2026-11-22 · Nhánh: claude/admiring-tesla-8xd417 · Repo: www-donghanhcungban-org/X-Workspace (đổi tên từ Social-Manager, D-012)

## Đang làm

- PR đợt xw-1 (nhánh `claude/admiring-tesla-8xd417` → main): chờ CI; merge là việc của người (`merge_autonomy: L1`, ngoại lệ cứng)

## Tiếp theo

1. Đợt xw-2 theo `docs/work/2026-11-22-x-workspace-plan/working.md` §5: module `evidence` (lưu bản gốc có phiên bản), `knowledge`/`search` (unaccent + pg_trgm), `ai` sau `ModelPort` (AI đám mây tắt mặc định)
2. Còn ~462 MUST blueprint mở (`xt.py blueprint-status BLUEPRINT.md --json`), đầu tiên BASE-CFG-003
3. Kiểm với khoá SocialAPI thật: hình dạng `GET /posts/{id}`, `conversation_id`/`platform_id` trong webhook (đang ghi "chưa xác minh")
4. CI: chạy cả hai project Playwright và có dịch vụ Postgres cho e2e

## Quyết định

- D-001..D-012 ở `docs/autopilot/DECISIONS.md`; mới: D-009 giữ đường dẫn `.xtemplates/`, D-010 thời hạn lưu theo workspace (mặc định 365 ngày), D-011 duyệt PLAN-xw-1, D-012 đổi tên sản phẩm/repo thành X-Workspace
- ADR-0002 (định hướng X-Workspace, một codebase), ADR-0003 (công cụ quy trình thuộc dự án)
- Nợ kỹ thuật chấp nhận: esbuild moderate qua drizzle-kit (hạn 2027-02-22); cảnh báo build Edge runtime ở `instrumentation.ts`/`src/config/env.ts` (có từ trước)
- Chưa xác minh: SocialAPI với khoá thật; Docker image chưa build (không có daemon)

## Bàn giao phiên

- Commit cuối: xem `git log -1` trên nhánh · Lệnh kiểm: `.xtemplates/scripts/dev-task.sh gate` → xanh (514 test)
- Đang chặn (cần người):
  - T-009: tạo `.env.example` (quy tắc quyền chặn agent ghi `.env*`)
  - T-108: gỡ di sản projects-template (guard chặn agent gỡ hook/agent/lệnh). Người chạy ở gốc repo:
    `git rm .claude/hooks/{block-dangerous-git,pre-commit-gate,session-guide,session-resume,telemetry-record,usage-guard,ui-intelligence,precompact-checkpoint}.sh`
    `git rm .claude/agents/{complex-implementer,coordinator,lookup,maintainer,mechanical-worker,security-reviewer,spec-executor,standard-worker,tester,version-check}.md`
    `git rm -r .claude/commands`
  - Remote cục bộ còn trỏ URL cũ (guard chặn `git remote set-url`); GitHub chuyển hướng nên push vẫn đúng repo
- Việc dở chưa commit: không
