# PROGRESS.md — X-Workspace

> Giai đoạn hiện tại: G7 pha harden (`/complete`) — đã phát hành 1.0.0 (tag `v1.0.0`, PR #24) nhưng `release-check` vẫn NO-GO · Cập nhật: 2026-11-23 · Nhánh: claude/adoring-lamport-ajmn5l · Repo: www-donghanhcungban-org/X-Workspace

## Đang làm

- Vòng harden bật (một phiên, trần 320 vòng, hạn 2026-12-14): `docs/autopilot/PLAN-harden-2026-11-23.md` (40 task, D-017, merge PR #35). Đang ở T-501 `/audit full`: ba cụm quét xong (SEC/CFG/DEP/CI, ARCH/CODE/TEST/PERF, A11Y/DATA), còn cụm DOC/HAR/XFEAT và xác minh đối kháng ba 🟠. Sổ nháp ở `docs/ops/AUDIT-STATUS.md`
- 🟠 đang chờ xác minh: AUD-CODE-001 (hành động gửi kẹt ở `dispatching`), AUD-CODE-002 (bỏ nháp sau khi xếp hàng vẫn gửi), AUD-DATA-001 (chưa có đường người dùng tự xoá/xuất dữ liệu)
- Trang dự án xw-4e đã merge (PR #32, #33): hồ sơ, bí danh, sổ quyết định, dòng thời gian bằng chứng. Gửi thật CHƯA bật (`OUTBOUND_LIVE=false`)

## Tiếp theo

1. Hoàn tất T-501 (sổ + báo cáo + `audit check` exit 0), rồi T-580/T-581/T-582 khai `migration_check`, `rollback`, `attack` trong `xt.yaml`
2. Sửa 🟠 theo thứ tự: AUD-CODE-001, AUD-CODE-002 (test đỏ trước), rồi AUD-DATA-001 (UI xoá/xuất)
3. Nhóm MUST blueprint còn mở (439, `xt.py blueprint-status BLUEPRINT.md --strict --json`) theo T-510..T-531; đầu tiên BASE-CFG-003 cần `.env.example` (T-009, cần người)
4. Cuối vòng: `release-check` GO + `GO-NO-GO.md` (§5 người ký; hàng `perf` đề xuất ký "không áp dụng")

## Quyết định

- D-001..D-017 ở `docs/autopilot/DECISIONS.md`; mới: D-017 duyệt PLAN-harden (không nới cổng)
- ADR-0002..0006 (định hướng, công cụ thuộc dự án, kho bản gốc theo hash, cổng AI, sổ hành động gửi tin)
- Nợ kỹ thuật chấp nhận: esbuild moderate qua drizzle-kit (hạn 2027-02-22) — audit phát hiện ghi chú ngoại lệ nêu sai (drizzle-kit vẫn vào image runtime qua peer của better-auth), xem AUD-DEP-001
- Chưa xác minh: SocialAPI và GitHub với khoá thật; Dockerfile/compose (volume `blobdata`) chưa build thật vì môi trường không có Docker

## Bàn giao phiên

- Nền: `main` @ `dbc1479` (PR #35) · Lệnh kiểm: `.xtemplates/scripts/dev-task.sh gate` → xanh ở CI; coverage 92,07% câu lệnh (`npm run test:coverage` exit 0)
- Đang chặn (cần người):
  - T-009: tạo `.env.example` (agent không ghi `.env*`); biến cần có: `BLOB_DIR`, `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`, `OUTBOUND_LIVE` (mặc định `false`)
  - T-108: gỡ di sản projects-template (guard chặn agent gỡ hook/agent/lệnh); người chạy `git rm` các hook/agent/`.claude/commands` đã liệt kê ở PLAN-harden T-108
  - T-209: token GitHub chỉ đọc cho repo pilot; T-406: bật gửi thật với khoá SocialAPI thật; T-306: mô hình AI thật
  - T-540..T-542: chữ ký GO-NO-GO §5 và hàng `perf` "không áp dụng"
  - gitleaks toàn lịch sử bị guard chặn trong lúc audit — chạy ở CI `secret-scan.yml` hoặc người chạy
- Triển khai: sao lưu volume `blobdata` cùng dump Postgres (RUNBOOK §Backup)
- Việc dở chưa commit: `docs/ops/AUDIT-STATUS.md` (sổ audit nháp) và file này
