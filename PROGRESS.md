# PROGRESS.md — X-Workspace

## Đang làm

- Vòng harden (một phiên, trần 320 vòng, hạn 2026-12-14): `docs/autopilot/PLAN-harden-2026-11-23.md` (40 task, D-017). Nhánh `fix/harden-batch-1`, PR #37 (đang "behind" `main`, chưa merge; CI chạy lại sau mỗi push)
- Xong từ T-501 đến T-531, T-550 (floor xanh), T-560 (5 spec F-001..F-005 có AC truy vết test, lint spec), T-561 (API-CONTRACT + OpenAPI + test so khớp), T-580/T-581 (migration trên dữ liệu, diễn tập rollback DB)
- Xong thêm T-582 (`tests/security/attack/`: 10 tệp, 111 test xanh; `attack` khai trong xt.yaml). Chưa làm: T-583, T-570, T-584

## Tiếp theo

1. T-583 (acceptance: `acceptance-author` viết `tests/acceptance` từ AC của spec, `acceptance lock`), T-570 (refactor CODE/ARCH, Gate `dev-task.sh gate`), T-584 (`blueprint-status --run` + `audit check --strict`)
2. Sau đó: `/audit delta`, trả nợ review, `release-check --json` → `loop next-step`, GO-NO-GO (§5 người ký)
3. PR #37: cập nhật nhánh theo `main`, chờ CI xanh rồi merge (hỏi chủ dự án một lần vì PR gộp nhiều task)
4. Dọn: tắt/xoá Postgres tạm cổng 55433 (db xw_e2e) nếu còn

## Quyết định

- D-001..D-034 ở `docs/autopilot/DECISIONS.md`. Mới: D-031 phạm vi VN-only, D-032 duyệt 5 spec theo code thật, D-033 hợp đồng API (oasdiff/redocly chưa có nên 4 MUST chuyển cho người), D-034 lỗi `0011.down.sql`
- Lỗi thật: `drizzle/0011_evidence_message_link.down.sql` bỏ cột `message_id` nhưng để lại dòng `evidence_items.source='message'` → migrator không tiến lại được (CHECK 23514). Migration nằm trong khoá v1.0.0 nên không sửa tại chỗ; test `tests/db/migration-data.test.ts` ghi nhận, RUNBOOK ghi bước dọn. Người duyệt ngoại lệ sửa down + cập nhật khoá

## Bàn giao phiên

- Nền: `main` @ `43149a7`; nhánh làm việc `fix/harden-batch-1` đã push. Lệnh kiểm: `.xtemplates/scripts/dev-task.sh gate` (CI)
- Chưa xác minh: SocialAPI và GitHub với khoá thật; Dockerfile/compose chưa build thật (không có Docker); các thẻ AC trong `e2e/` chưa chạy ở phiên này vì cần `E2E_DATABASE_URL`; luật VN (Luật 91/2025, NĐ 356/2025) mới đối chiếu nguồn thứ cấp, chưa với bản gốc
- Cần người (đã `loop defer`): T-009 `.env.example`; T-108 gỡ di sản projects-template; T-209/T-306/T-406 khoá thật; T-540..T-542 chữ ký GO-NO-GO; CMP-VN-004/006/007, CMP-AUDIT-010 (hồ sơ chuyển dữ liệu, diễn tập vi phạm, DSAR có due_at, đối chiếu Luật 91/2025 với bản gốc); WF-REL-004/007, OPS-DEPLOY-003/004 (diễn tập rollback artifact, smoke ở pipeline deploy, N−1); DB-BACKUP-002, OPS-DR-008; BASE-REPO-006, WF-REL-003, XC-OSS-007 (tag chú thích, ruleset tag, SHA256SUMS/SBOM); STD-API-008, STD-PROC-003, QA-INT-007, BE-API-001 (thêm oasdiff/redocly vào CI)
- Nâng Node 26 ("nâng luôn"): chưa làm, cần chủ dự án xác nhận nghĩa; chỉ làm sau CI xanh, commit riêng
