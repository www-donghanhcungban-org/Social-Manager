# PROGRESS.md — X-Workspace

> Giai đoạn hiện tại: G6 Build — đợt xw-1 đã merge (PR #23); xw-2, xw-3 đã merge (PR #25, #26); xw-4 (gửi tin có kiểm chứng) xong phần làm được · Cập nhật: 2026-11-22 · Nhánh: claude/admiring-tesla-8xd417 · Repo: www-donghanhcungban-org/X-Workspace

## Đang làm

- xw-4 đã merge (PR #27: nháp, chính sách gửi, sổ hành động, `send_unknown`, job, `OUTBOUND_LIVE` tắt). Đợt xw-4b (T-411..T-413, đã merge PR #28): dịch vụ đọc hội thoại, nhãn tiếng Việt, trang `/conversations` (soạn nháp, yêu cầu gửi, lịch sử, quyết định `send_unknown`); Đợt xw-4c (T-421, T-422, đã merge PR #29): trang `/search` tìm kiếm và hỏi đáp có trích dẫn (AI tắt thì chỉ tìm kiếm). Đợt xw-4d (T-431): trang `/documents` nhập tài liệu và tạo dự án; PR chờ CI. Gửi thật CHƯA bật

## Tiếp theo

1. Giao diện cho bí danh/liên kết dự án, sổ quyết định, độ bao phủ, xuất/xoá dữ liệu; T-406 bật gửi thật khi có khoá SocialAPI
2. Giao diện cho kho bằng chứng, dự án, hộp chờ, tìm kiếm, hỏi đáp, độ bao phủ (hiện mới có dịch vụ; chỉ có màn hình thời hạn lưu)
3. Nối dịch vụ hỏi đáp/tìm kiếm vào Server Action và trang; thử AI thật (T-306) và đối chiếu chất lượng; thêm tìm kiếm mờ `pg_trgm` khi cần
4. Còn ~440 MUST blueprint mở (`xt.py blueprint-status BLUEPRINT.md --json`), đầu tiên BASE-CFG-003 (cần `.env.example`)

## Quyết định

- D-001..D-016 ở `docs/autopilot/DECISIONS.md`; mới: D-012 đổi tên X-Workspace, D-013 phạm vi xw-2, D-014 phạm vi xw-3 (chưa thêm AI SDK/pg_trgm)
- ADR-0002 (định hướng), ADR-0003 (công cụ quy trình thuộc dự án), ADR-0004 (kho bản gốc theo hash, `BLOB_DIR`), ADR-0005 (cổng AI: tắt mặc định, đám mây theo workspace), ADR-0006 (gửi tin: sổ hành động, hai khoá, không tự gửi lại)
- Nợ kỹ thuật chấp nhận: esbuild moderate qua drizzle-kit (hạn 2027-02-22); cảnh báo build Edge runtime ở `instrumentation.ts`/`src/config/env.ts` (có từ trước)
- Chưa xác minh: SocialAPI và GitHub với khoá thật (đặc biệt `GET /posts/{id}`, tham số pull reviews); Dockerfile/compose mới (volume `blobdata`) chưa build/chạy thật vì môi trường làm việc không có daemon Docker

## Bàn giao phiên

- Nền trên nhánh chính: `ceea920` (PR #23, #25..#29 đã merge) · Việc xw-4d ở nhánh này · Lệnh kiểm: `.xtemplates/scripts/dev-task.sh gate` → xanh
- Đang chặn (cần người):
  - T-009: tạo `.env.example` (quy tắc quyền chặn agent ghi `.env*`); biến mới cần có trong đó: `BLOB_DIR` (mặc định `./.data/blobs`; compose `/data/blobs`), `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY` (AI tắt khi `AI_BASE_URL` trống), `OUTBOUND_LIVE` (mặc định `false`)
  - T-108: gỡ di sản projects-template (guard chặn agent gỡ hook/agent/lệnh). Người chạy ở gốc repo:
    `git rm .claude/hooks/{block-dangerous-git,pre-commit-gate,session-guide,session-resume,telemetry-record,usage-guard,ui-intelligence,precompact-checkpoint}.sh`
    `git rm .claude/agents/{complex-implementer,coordinator,lookup,maintainer,mechanical-worker,security-reviewer,spec-executor,standard-worker,tester,version-check}.md`
    `git rm -r .claude/commands`
  - T-209: token GitHub chỉ đọc cho repo pilot (và chỗ lưu khoá kết nối GitHub) để thử connector thật
  - T-406: bật gửi thật — thử một kênh thật với khoá SocialAPI thật (kiểm hình dạng phản hồi gửi, tên mã hết cửa sổ), rồi owner đặt `outbound_enabled` và vận hành đặt `OUTBOUND_LIVE=true`; tác tử không bật
  - T-306: mô hình AI thật (Ollama cục bộ hoặc khoá dịch vụ) để thử hỏi đáp và đối chiếu chất lượng
  - Remote cục bộ còn trỏ URL cũ (guard chặn `git remote set-url`); GitHub chuyển hướng nên push vẫn đúng repo
- Triển khai: sao lưu volume `blobdata` cùng dump Postgres (RUNBOOK §Backup); mất volume là mất nội dung bằng chứng
- Việc dở chưa commit: không
