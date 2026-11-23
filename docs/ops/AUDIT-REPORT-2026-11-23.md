# AUDIT-REPORT — X-Workspace · 2026-11-23

> Commit: `dbc14791cbf53664aa69b9339bc5b9f3bffd4ca3` · Phạm vi: toàn bộ 13 nhóm (8 đã quét, 5 rút gọn) · Người quét: 4 subagent `reviewer` chỉ đọc + phiên chính · Xác minh đối kháng: `reviewer-alt` (Opus 5.5, effort max) cho mọi 🟠
> `xt.py audit check docs/ops/AUDIT-STATUS.md` → exit 0

## 1. Tóm tắt

| Mức | Mở  | Đã sửa | Chấp nhận | Bác bỏ |
| --- | --- | ------ | --------- | ------ |
| 🔴  | 0   | 0      | 0         | 0      |
| 🟠  | 5   | 0      | 0         | 0      |
| 🟢  | 55  | 0      | 0         | 0      |

Kết luận: không có 🔴, nhưng 5 🟠 đã xác minh đối kháng (hai lỗi trên đường gửi tin, thiếu đường xoá/xuất dữ liệu, bốn test tích hợp chưa từng chạy ở CI, SECURITY.md khai sai hàng rào) chặn phát hành 1.0.0 qua G7 cho tới khi sửa hoặc người chấp nhận có hạn.

Lưu ý chính xác về số: ba 🟠 đầu giữ nguyên mức sau xác minh; AUD-HAR-003 được hạ từ 🟠 xuống 🟢; các lệch tài liệu và cấu hình do cụm DOC/HAR/XFEAT báo ở mức 🟠 được phiên chính hạ xuống 🟢 (nợ có chủ, đã gắn task PLAN-harden) vì không có đường tái hiện dẫn tới hành vi sai; riêng AUD-HAR-005 và AUD-DOC-001 được kiểm lại độc lập và giữ 🟠.

## 2. Phạm vi và tín hiệu

`xt.py audit plan` @ dbc1479: 426 file · python 1, js/ts 200, shell 20 · test 91 · UI 30 · CSDL 40 · CI 13 workflow. Cả 13 nhóm áp dụng.

Công cụ thiếu (bằng chứng nhóm đó là `chưa biết:`): lint-imports, depcruise, gitleaks (guard chặn khi chạy), semgrep, osv-scanner, bandit, vulture, knip, shellcheck, jscpd, k6, lighthouse, axe CLI, pip-audit, actionlint, zizmor, lychee.

Nhóm `rút gọn`: CODE (chưa đọc hết auth, connectors/github, posts, inbox, conversations/sync, providers), PERF (chỉ rà mã và truy vấn, chưa có số đo tải), DOC (chưa đọc kỹ docs/work, docs/research, DECISIONS.md, BLUEPRINT-BACKLOG.md; chưa kiểm anchor), XFEAT (4 trang chính), HAR (chưa rà fail-open/fail-closed bên trong từng hook; `blueprint-status --strict --run` quá 580 s).

## 3. Lệnh đã chạy

| Nhóm   | Lệnh                                                        | Exit | Kết quả chính                                                                    |
| ------ | ----------------------------------------------------------- | ---- | -------------------------------------------------------------------------------- |
| TEST   | `npm run test:coverage`                                     | 0    | statements 92,07% · branches 89,46% · functions 85,54% · lines 93,93%            |
| SEC/CI | `xt.py ci-check`                                            | 0    | 13 workflow: permissions, ghim SHA, timeout                                      |
| DEP    | `npm audit --omit=dev`                                      | 1    | 4 moderate (esbuild qua drizzle-kit), 0 high                                     |
| DEP    | `npm ls esbuild --omit=dev`                                 | 0    | better-auth, drizzle-kit, esbuild 0.18.20                                        |
| CODE   | `npx tsc --noEmit`                                          | 0    | xanh                                                                             |
| CODE   | `npx eslint --max-warnings 0 .`                             | 0    | xanh                                                                             |
| ARCH   | `cycles.py` (script quét import trong scratch)              | 0    | module cycle giữa evidence và search                                             |
| A11Y   | `xt.py contrast app/globals.css --pairs contrast-pairs.txt` | 0    | 28 cặp, 0 đỏ                                                                     |
| A11Y   | `playwright test e2e/a11y-responsive.spec.ts` (+ spec tạm)  | 0    | axe 0 vi phạm trên 14 trạng thái                                                 |
| DATA   | `node scripts/migrate.mjs` (Postgres 16 tạm)                | 0    | migration xong; 20 cặp up/down có test                                           |
| HAR    | `xt.py doctor --json`                                       | 0    | 0 lỗi, 2 cảnh báo                                                                |
| HAR    | `xt.py harness-check`                                       | 1    | 2 ✗ (xem AUD-HAR-003)                                                            |
| HAR    | `xt.py blueprint-status BLUEPRINT.md --strict --run`        | 124  | quá 580 s                                                                        |
| DOC    | `npx vitest run tests/config`                               | 0    | 115 test pass                                                                    |
| TEST   | `npx vitest run` (không đặt TEST_DATABASE_URL)              | 0    | 74 file pass, 2 skip; 869 test pass, 4 skip                                      |
| SEC    | gitleaks toàn lịch sử                                       | —    | bị guard chặn; thay bằng grep regex tay, 8 dòng khớp đều là mẫu của công cụ quét |

## 4. Phát hiện chi tiết (🟠)

### AUD-CODE-001 🟠 Hành động gửi kẹt vĩnh viễn ở `dispatching`

- **Bằng chứng:** đo được — `src/actions/ledger.ts:353-446`; không có job nào gỡ dòng `dispatching` (`reconcileDue` chỉ quét `send_unknown`, `resolveUnknown` chỉ nhận `send_unknown`, CHECK `attempts ≤ 1`).
- **Tái hiện:** 1. Gây một lỗi DB tạm thời sau khi `dispatch` đã đặt `dispatching` (hoặc giết tiến trình trong lúc `sendMessage` chạy). 2. Chạy `dispatchDue`, `reconcileDue`, `resolveUnknown`, `cancel` và mọi handler của runner, kể cả sau 30 ngày. → dòng vẫn `dispatching` (hoặc `cancel_requested`), `requestSend` mới trả `idempotency_conflict`, giao diện ẩn cả Yêu cầu gửi lẫn Bỏ nháp nên hội thoại không trả lời được.
- **Xác minh đối kháng:** `reviewer-alt` (Opus 5.5) tái hiện 5/5 (`f1-stuck.test.ts`, ba đường A lỗi DB trước khi gửi, B hai lần `finish` lỗi, C tiến trình chết). Mức thật: 🟠 ở cận trên — không gửi trùng, không mất dữ liệu, nhưng nguyên nhân rất thực tế (lỗi tạm hoặc deploy giữa chừng), kẹt vĩnh viễn, chưa có runbook.
- **Đề xuất sửa:** job theo khuôn `posts.recoverStuck` (`src/posts/service.ts:403-413`): `dispatching` hoặc `cancel_requested` quá hạn → `send_unknown` (`errorCode: interrupted`) để reconcile/resolveUnknown xử lý; bọc các kiểm tra trước khi gửi bằng try/catch → `failed`; không bao giờ đưa về `queued` (CHECK `attempts ≤ 1` sẽ làm `dispatchDue` reject cả hàng đợi). · **Gate:** `npx vitest run tests/actions/ledger-stuck.test.ts` (đỏ trước khi sửa).

### AUD-CODE-002 🟠 Bỏ nháp sau khi đã xếp hàng gửi vẫn gửi tin

- **Bằng chứng:** đo được — `src/actions/drafts.ts:185-199` (`discard` chỉ đổi `drafts.status`), `src/actions/ledger.ts:387-390` (`dispatch` không kiểm `drafts.status`).
- **Tái hiện:** 1. `requestSend` với cả hai khoá bật → `queued`. 2. `discard` → giao diện báo Đã bỏ nháp. 3. `dispatchDue` → provider `sendMessage` được gọi, action `confirmed`, nháp vẫn `discarded`. Đối chứng `cancel` thì `sendCalls=0`.
- **Xác minh đối kháng:** `reviewer-alt` tái hiện 4/4 (`f2-discard.test.ts`), kể cả trường hợp thành viên khác bỏ nháp và trường hợp bỏ nháp A rồi gửi nháp B khiến khách nhận hai tin. Mức thật ở cận dưới 🟠: giao diện ẩn nút Bỏ nháp khi có hành động còn hiệu lực nên phải qua tab cũ, thành viên khác hoặc gọi thẳng server action; vẫn giữ 🟠 vì thao tác ra ngoài không đảo ngược, trái ADR-0006 (thà không gửi).
- **Đề xuất sửa:** `discard` huỷ action `queued` cùng giao dịch và từ chối khi đang `dispatching`/`send_unknown`/`cancel_requested`; `dispatch` kiểm `drafts.status='open'` lúc nhận việc và ngay trước khi gửi. · **Gate:** `npx vitest run tests/actions/discard-after-queue.test.ts`.

### AUD-DATA-001 🟠 Người dùng không tự xoá hay xuất dữ liệu được

- **Bằng chứng:** đo được — `src/server/container.ts:96`; grep `erasure` ở `app/`, `scripts/`, `src/jobs` chỉ ra `container.ts` và `erasure.ts`; `BLUEPRINT.md:860,885` (CMP-RIGHTS-007, CMP-PRIV-005 mở).
- **Tái hiện:** 1. Đăng nhập, `POST /api/auth/delete-user` với đúng mật khẩu → 404 ("Delete user is disabled", `f3-self-delete.test.ts`). 2. Tìm đường gọi `eraseConversation`/`eraseProject`/`export` từ giao diện → không có.
- **Xác minh đối kháng:** `reviewer-alt` tái hiện được. Không phải phát hiện mới: `PROJECT.md:119` đã ghi nợ, T-529 của PLAN-harden đã nhận. Đính chính phạm vi: `ErasureService` là công cụ của owner cho dữ liệu khách bên thứ ba; nối giao diện không đáp ứng CMP-PRIV-005 (xoá tài khoản người dùng app) — đó là khoảng trống riêng (`deleteUser` tắt, `members.user_id` chưa có FK).
- **Đề xuất sửa:** gộp vào T-529: giao diện owner xoá/xuất theo hội thoại, dự án, bằng chứng; bật `user.deleteUser` có xác nhận và xử lý thành viên mồ côi; sửa `PROJECT.md:87` đang gây hiểu sai. · **Gate:** `npx playwright test e2e/erasure.spec.ts`.

### AUD-HAR-005 🟠 Bốn test tích hợp Postgres chưa từng chạy ở CI

- **Bằng chứng:** đo được — `grep TEST_DATABASE_URL .github xt.yaml package.json` ra 0; `tests/auth/members.pg.test.ts:19-20` và `tests/jobs/pgboss.integration.test.ts:14-15` dùng `describe.skip` khi thiếu biến; `npx vitest run` toàn bộ: 74 file pass, 2 skip; 869 test pass, 4 skip.
- **Tái hiện:** 1. `npx vitest run tests/auth/members.pg.test.ts tests/jobs/pgboss.integration.test.ts` không đặt biến → exit 0, `4 skipped`. 2. `ci.yml:129-143` chỉ cấp service Postgres cho job `e2e`; job `gate` (`ci.yml:41,80`) chạy vitest không có.
- **Xác minh đối kháng:** `reviewer-alt` tái hiện được; đính chính mô tả ban đầu (service Postgres chỉ ở job `e2e`; số đo thật 74/2 file, 869/4 test). Giữ 🟠: 2 test race giữ bất biến "luôn còn ít nhất một owner", 2 test pg-boss (đúng một lần, đăng ký 7 lịch); QA-INT-001 còn mở. Không lên 🔴 vì phần skip đã khai `DEBT:` và hiện rõ "skipped".
- **Đề xuất sửa:** thêm service Postgres ghim digest vào job `gate` (hoặc job mới) đặt `TEST_DATABASE_URL`; cho test tự đỏ khi `process.env.CI` có mà thiếu biến. · **Gate:** `CI=true npx vitest run tests/auth/members.pg.test.ts tests/jobs/pgboss.integration.test.ts` (đỏ khi thiếu biến).

### AUD-DOC-001 🟠 SECURITY.md khai hàng rào không có thật

- **Bằng chứng:** đo được — `SECURITY.md:21` hook `pre-commit-gate.sh` "đang chạy" nhưng không đăng ký trong `.claude/settings.json`, `.git/hooks` chỉ có `*.sample`, hai file nó cần (`scripts/_commit-guard.sh`, `scripts/dev-task.sh`) không tồn tại; `:22` Dependabot có pip (thực tế chỉ github-actions và npm); `:24` `scripts/check-ci-policy.sh` và ShellCheck không có; `:26` ADR-0009 và `docs/ops/threat-model-maintain-cron.md` không có; `:28` "scripts/*.py và *.sh" (chỉ có `migrate.mjs`); `:32` `docs/framework/…` không có; `:39` "RLS bật và đã test" trái `PROJECT.md:51` (không dùng RLS).
- **Xác minh đối kháng:** `reviewer-alt` tái hiện được; bác bỏ riêng mục "CodeQL python" (chỉ lỗi thời, `codeql.yml:33` có python). Hệ quả: tài liệu khai một lớp quét bí mật trước commit không tồn tại (gitleaks chỉ chạy ở CI) và một bất biến RLS trái kiến trúc. Giữ 🟠, không lên 🔴 vì phần lớn hàng rào thật vẫn có dưới tên khác.
- **Đề xuất sửa:** viết lại SECURITY.md theo hàng rào thật của dự án; thêm test trong `tests/config/repo-docs.test.ts`: mọi đường dẫn trong backtick phải tồn tại và không còn câu "RLS bật". · **Gate:** `npx vitest run tests/config/repo-docs.test.ts` (test mới đỏ trước khi sửa).

## 5. Kế hoạch sửa theo đợt (tự duyệt — D-018)

Các đợt khớp task PLAN-harden-2026-11-23; mỗi đợt một PR, bug có test đỏ trước khi sửa.

| Đợt | Phát hiện                                   | PR dự kiến                                                          | Gate của đợt                                      |
| --- | ------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------- |
| 1   | AUD-CODE-001, AUD-CODE-002 (T-502)          | `fix(actions): gỡ hành động kẹt dispatching và chặn gửi nháp đã bỏ` | `npx vitest run tests/actions`                    |
| 2   | AUD-HAR-005 (T-517/T-522)                   | `ci: chạy test tích hợp Postgres ở job gate`                        | `CI=true npx vitest run tests/auth tests/jobs`    |
| 3   | AUD-DOC-001, AUD-DOC-002..010 (T-512/T-560) | `docs: viết lại SECURITY.md và đồng bộ tài liệu với mã`             | `npx vitest run tests/config/repo-docs.test.ts`   |
| 4   | AUD-DATA-001, AUD-DATA-002 (T-529)          | `feat(retention): giao diện xoá/xuất và xoá tài khoản`              | `npx playwright test e2e/erasure.spec.ts`         |
| 5   | AUD-HAR-001..012 (T-511/T-108)              | `chore(harness): đồng bộ cấu hình harness với tài liệu`             | `python3 .xtemplates/scripts/xt.py harness-check` |

## 6. Nợ 🟢 giữ lại

55 mục 🟢 mở (xem `AUDIT-STATUS.md`), gồm AUD-CI-002 (changelog-check đỏ sau Release Please) và AUD-CI-003 (license-check thiếu `license-allow.json`) do `xt.py checks` báo đỏ ở 2/5 mục. Chủ mặc định là phiên harden; hạn mặc định là cuối vòng harden (2026-12-14) trừ khi người chấp nhận có hạn khác. Mục cần người: AUD-HAR-001/008 (gỡ di sản, T-108), AUD-DEP-002 (ghi chú giấy phép), AUD-SEC-001 (đăng ký mở là quyết định sản phẩm).

## 7. Việc không làm được và chưa biết

- gitleaks toàn lịch sử bị guard chặn (hiểu nhầm `git` với tuỳ chọn lạ); mục secret chỉ là grep tay — CI `secret-scan.yml` có chạy `--all`, nên đối chiếu log CI.
- Không chạy được: k6, lighthouse, zizmor, actionlint, axe CLI; tab-through bàn phím thật; e2e đầy đủ (không có Postgres trong môi trường); `blueprint-status --strict --run` quá giờ.
- Cụm DOC/HAR/XFEAT chạm trần 80 lượt và INCONCLUSIVE; 5 nhóm ghi `rút gọn` với phần chưa kiểm nêu ở mục 2.
- Phân loại 442 MUST mở theo tiền tố (kiểm ngay / việc mới / N/A) là ước lượng của cụm DOC, chưa đọc từng mục; BLUEPRINT hiện có 442 MUST mở chứ không phải 439 (439 tự làm được cộng 3 lớp B); gate của PLAN phủ 441/442 ID.
