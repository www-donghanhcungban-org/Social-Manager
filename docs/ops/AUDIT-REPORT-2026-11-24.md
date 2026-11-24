# AUDIT-REPORT 2026-11-24 — delta dbc1479..3dc103d (nhánh `fix/harden-batch-1`, PR #37)

Chế độ: `/audit delta` trong `/complete` (bước 5.1). Sổ: `docs/ops/AUDIT-STATUS.md`.

## Tóm tắt

- 🔴 0 · 🟠 5 mở · 🟢 30 mới (sổ có 79 🟢 mở).
- Phạm vi: 277 tệp đổi từ `dbc1479`. Ba reviewer chỉ đọc theo cụm; hai cụm báo INCONCLUSIVE vì chưa rà hết (liệt kê bên dưới), nên 9 nhóm ở trạng thái `rút gọn`.
- Xác minh đối kháng: reviewer-alt (Opus 5.5, effort max) tái hiện độc lập 6 phát hiện 🟠 ở HEAD, không nhận lý luận của người tìm. 5 giữ 🟠, 1 hạ 🟢 (`AUD-DOC-011`).
- SHA nhóm giữ `dbc1479` vì `audit check` đòi SHA nằm trên `origin/main` (squash-merge xoá SHA nhánh). Lần quét thực hiện trên `3dc103d`; cập nhật SHA sau khi PR #37 merge.

## 🟠 (tái hiện từng bước ở cột Bằng chứng của sổ)

| ID           | Tóm tắt                                                                   | Gate (đỏ trước khi sửa)                                                  |
| ------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| AUD-CI-004   | Artifact coverage tải lên trước khi sinh coverage; QA-COV-001 xanh giả    | `npx vitest run tests/config/test-strategy.test.ts` + assert thứ tự bước |
| AUD-CODE-008 | Xoá tài khoản cho dò mật khẩu không giới hạn                              | `npx vitest run tests/retention/rights.test.ts` + ca khoá sau N lần sai  |
| AUD-CODE-009 | Retry/DLQ pg-boss không áp cho hàng đợi cũ (`updateQueue` không được gọi) | `npx vitest run tests/jobs` + ca tạo sẵn hàng đợi mặc định               |
| AUD-HAR-013  | WF-SDD-001 tick nhưng chỉ có spec F-001..F-005                            | `npx vitest run tests/config/specs.test.ts` + ca route không gắn spec    |
| AUD-DATA-008 | Trang tài khoản hứa xuất theo dự án nhưng không có nút xuất               | `npx vitest run tests/retention/erasure.test.ts` + e2e/test câu chữ      |

## Kế hoạch sửa (đợt kế, mỗi 🟠 một commit có test đỏ trước)

1. AUD-CI-004 và AUD-CODE-009 (nhỏ, cơ học, có Gate rõ).
2. AUD-CODE-008 (chạm `src/auth` và `src/retention`: đường dẫn nhạy cảm, PR cần người merge — LOOP-STOP-005).
3. AUD-DATA-008 và AUD-HAR-013 (cần quyết định phạm vi: viết spec bù hay thu hẹp tuyên bố).
4. 🟢: gom theo nhóm; `AUD-SEC-006..009`, `AUD-CODE-010..013` làm trước, phần còn lại nợ có chủ.

## Chưa rà (chua_ra)

- ARCH/CODE/TEST/PERF: nội dung chi tiết 174 test acceptance (mới quét heuristic), `src/ai/guard.ts`, `redact.ts`, `answer.ts`, `src/providers/socialapi/index.ts` ngoài đoạn `invalid_path`, `src/log/*`, `src/format/*`, trang `app/*` mới, migration 0021+ ngoài backfill.
- DOC/HAR/XFEAT/A11Y/DATA: lý do N/A của DB-SEC-007 (chưa grep SQL thô), từng AC của F-002..F-005 so với mã, THREAT-MODEL/ARCHITECTURE/DPIA toàn văn, tương phản màu và axe.
- Công cụ chưa cài nên `chưa biết:` ở mức công cụ: gitleaks, semgrep, actionlint, zizmor, depcruise, knip, lychee, axe.

## Bị chặn

- Guard từ chối lệnh đọc `.env.example` (quy tắc quyền); không đường khác.
- `.claude/skills/review/SKILL.md` không tồn tại dù `reviewer.md` dẫn tới; reviewer rà theo `00-method/audit.md` và `10-workflow/code-review.md`. Ghi `feedback add` cho khung.
