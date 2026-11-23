# PROGRESS.md — X-Workspace

> Giai đoạn hiện tại: G6 Build — đợt xw-1 đã merge (PR #23); xw-2 (kho bằng chứng) và xw-3 (tìm kiếm, sổ quyết định, AI) xong phần làm được, ở PR #25 · Cập nhật: 2026-11-22 · Nhánh: claude/admiring-tesla-8xd417 · Repo: www-donghanhcungban-org/X-Workspace

## Đang làm

- PR [X-Workspace#25](https://github.com/www-donghanhcungban-org/X-Workspace/pull/25) (nhánh → main): đợt xw-2 (T-201..T-208: kho bản gốc, dự án, xoá/xuất, connector GitHub) và xw-3 (T-301..T-305: tìm kiếm tiếng Việt, sổ quyết định, cổng AI, hỏi đáp có trích dẫn, bộ 50 câu). Chờ CI; merge là việc của người (`merge_autonomy: L1`)

## Tiếp theo

1. Đợt xw-4 (working.md §5): bản nháp có phiên bản, chính sách hành động, sổ hành động, gửi trả lời có kiểm chứng, `send_unknown` và đối soát (H3, H12)
2. Giao diện cho kho bằng chứng, dự án, hộp chờ, tìm kiếm, hỏi đáp, độ bao phủ (hiện mới có dịch vụ; chỉ có màn hình thời hạn lưu)
3. Nối dịch vụ hỏi đáp/tìm kiếm vào Server Action và trang; thử AI thật (T-306) và đối chiếu chất lượng; thêm tìm kiếm mờ `pg_trgm` khi cần
4. Còn ~440 MUST blueprint mở (`xt.py blueprint-status BLUEPRINT.md --json`), đầu tiên BASE-CFG-003 (cần `.env.example`)

## Quyết định

- D-001..D-014 ở `docs/autopilot/DECISIONS.md`; mới: D-012 đổi tên X-Workspace, D-013 phạm vi xw-2, D-014 phạm vi xw-3 (chưa thêm AI SDK/pg_trgm)
- ADR-0002 (định hướng), ADR-0003 (công cụ quy trình thuộc dự án), ADR-0004 (kho bản gốc theo hash, `BLOB_DIR`), ADR-0005 (cổng AI: tắt mặc định, đám mây theo workspace)
- Nợ kỹ thuật chấp nhận: esbuild moderate qua drizzle-kit (hạn 2027-02-22); cảnh báo build Edge runtime ở `instrumentation.ts`/`src/config/env.ts` (có từ trước)
- Chưa xác minh: SocialAPI và GitHub với khoá thật (đặc biệt `GET /posts/{id}`, tham số pull reviews); Dockerfile/compose mới (volume `blobdata`) chưa build/chạy thật vì môi trường làm việc không có daemon Docker

## Bàn giao phiên

- Nền trên nhánh chính: `f405483` (PR #23 đã merge) · Việc xw-2 ở PR #25 · Lệnh kiểm: `.xtemplates/scripts/dev-task.sh gate` → xanh
- Đang chặn (cần người):
  - T-009: tạo `.env.example` (quy tắc quyền chặn agent ghi `.env*`); biến mới cần có trong đó: `BLOB_DIR` (mặc định `./.data/blobs`; compose `/data/blobs`), `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY` (AI tắt khi `AI_BASE_URL` trống)
  - T-108: gỡ di sản projects-template (guard chặn agent gỡ hook/agent/lệnh). Người chạy ở gốc repo:
    `git rm .claude/hooks/{block-dangerous-git,pre-commit-gate,session-guide,session-resume,telemetry-record,usage-guard,ui-intelligence,precompact-checkpoint}.sh`
    `git rm .claude/agents/{complex-implementer,coordinator,lookup,maintainer,mechanical-worker,security-reviewer,spec-executor,standard-worker,tester,version-check}.md`
    `git rm -r .claude/commands`
  - T-209: token GitHub chỉ đọc cho repo pilot (và chỗ lưu khoá kết nối GitHub) để thử connector thật
  - T-306: mô hình AI thật (Ollama cục bộ hoặc khoá dịch vụ) để thử hỏi đáp và đối chiếu chất lượng
  - Remote cục bộ còn trỏ URL cũ (guard chặn `git remote set-url`); GitHub chuyển hướng nên push vẫn đúng repo
- Triển khai: sao lưu volume `blobdata` cùng dump Postgres (RUNBOOK §Backup); mất volume là mất nội dung bằng chứng
- Việc dở chưa commit: không
