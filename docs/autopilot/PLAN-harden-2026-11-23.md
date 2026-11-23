# docs/autopilot/PLAN-harden-2026-11-23.md — X-Workspace · Pha harden đợt 1 (/complete Bước 3)

> Duyệt: D-NNN (BẢN NHÁP — phiên chính tự duyệt bằng `xt.py loop decide --question "Duyệt PLAN-harden 2026-11-23"`) · Nền: `release-check` @ 9576a5f = NO-GO · Blueprint: BLUEPRINT.md · Sổ audit: docs/ops/AUDIT-STATUS.md (chưa có)

## Tóm tắt (≤ 30 dòng)

- **Vấn đề:** `release-check` NO-GO với 7 hàng BLOCKER: blueprint FAIL (439 MUST mở tự làm được + 3 lớp B chờ người; 4 MUST tick bằng
  "Bằng chứng" thay vì lệnh kiểm), audit FAIL (chưa có `docs/ops/AUDIT-STATUS.md`), N/A chưa khai: `attack`, `perf`, `migration_check`,
  `acceptance`, `rollback`. PASS: tree, prod_switch, phase.
- **Thứ tự file theo Bước 3 (a)→(g); thứ tự CHẠY đề nghị để giảm BLOCKER nhanh nhất:**
  1. `T-501` audit full (mở khoá hàng audit; `loop next-step` hiện trả `action: audit`).
  2. `T-580` khai `migration_check` — lệnh đã chạy xanh hôm nay, bỏ ngay 1 BLOCKER; rồi `T-581` rollback, `T-582` attack.
  3. `T-542` gửi người quyết `perf` (ký "không áp dụng") song song, không chờ.
  4. `T-510` (31 MUST "Không áp dụng" có điều kiện) → các nhóm MUST rẻ (`T-511` LOOP, `T-512` PM, `T-513` GATE…) → nhóm có mã.
  5. `T-502`/`T-503` sửa 🔴/🟠 xen kẽ (🔴 trước mọi MUST); `T-560` SPEC trước `T-583` acceptance.
  6. `T-550` sàn, `T-570` refactor, `T-584` kiểm tổng cuối.
- **Lý do:** hàng release-check khai lệnh là việc nhỏ, bằng chứng máy ngay; blueprint là khối lớn nhất (≈ 440 mục, 22 task) nên
  làm theo nhóm tiền tố, mỗi Gate đỏ tới khi mọi ID của nhóm hết `[ ]` (grep) và lệnh test của nhóm xanh.
- **Rủi ro:** (1) sổ audit chưa có → số 🔴/🟠 chưa biết; nếu > ~15 việc thì lập `PLAN-harden-<ngày>-2`, không phình T-502/T-503.
  (2) 16 công cụ audit thiếu (gitleaks, semgrep, osv-scanner, k6, lighthouse, axe CLI…) — ghi "thiếu công cụ", không bịa kết quả.
  (3) `blueprint-status --run` đã quá 600 s khi thử → T-584 cần `XT_RECORD_TIMEOUT=3600`. (4) Kiểm DB chạy trên PGlite, prod là
  Postgres 16 — QA-INT-001 đòi cùng major (chưa xác minh bản PG của PGlite). (5) `harness-check` đang đỏ (settings `permissions.ask`
  có 3 mục force-push; agent di sản `coordinator.md`) và `xt.py checks` đỏ ở license-check (thiếu `license-allow.json`) — đưa vào T-501.
  (6) Commit trong phiên cloud bị bộ phân loại Auto chặn → đẩy từng lát qua công cụ GitHub. (7) Mã task: parser chỉ nhận `T-\d{3,}`
  (`TASK_RE`, xt.py:290) nên dùng `T-5NN`; mã `H-NNN` ghi trong ngoặc để đối chiếu.
- **Việc cần người (`loop defer`, không nằm trên đường chính):** T-009 `.env.example` · T-108 gỡ di sản · T-540 quản trị GitHub
  (ruleset, required check, environment) · T-541 hạ tầng/dịch vụ thật (backup ngoài máy, error tracking, log tập trung, TLS DB, preview,
  quét image cần Docker) · T-542 quyết định chủ dự án (RPO/RTO, phân loại AI, lớp B, ký N/A `perf`, kiểm trình đọc màn hình).
  Cùng ký §5 GO-NO-GO khi có `VERSION`. Gửi thật giữ TẮT (`OUTBOUND_LIVE=false`).

## Mục tiêu của kế hoạch này

Đưa `release-check` từ 7 BLOCKER về chỉ còn hàng cần người (perf N/A chờ ký, MUST lớp A/B, chữ ký GO-NO-GO): sổ audit `--strict` xanh,
mọi MUST tự làm được đã `[x] — Kiểm:` hoặc `[~] — Không áp dụng:`, ba hàng production (`migration_check`, `rollback`, `acceptance`) và
`attack` có lệnh thật exit 0.

## Ngân sách (4 con số)

- Số vòng tối đa: 320 (`--max-iterations`; 8 × 40 task)
- Ngân sách: theo phiên (một phiên tới khi xong, quyền Auto)
- Timeout mỗi lệnh Gate: 1800 giây (`XT_RECORD_TIMEOUT`); riêng T-584 đặt 3600
- Ngày hết hạn: 2026-12-14T00:00:00Z (`--hours`)

## Hạn

| Loại          | Ngày       | Hậu quả nếu trễ | Cách xử lý khi trễ                                                      |
| ------------- | ---------- | --------------- | ----------------------------------------------------------------------- |
| Hạn mong muốn | 2026-12-14 | nội bộ          | re-plan (PLAN-harden kế), cắt nhóm SHOULD/backlog, không hạ cổng/ngưỡng |

## Ủy quyền production

- grant: payments | mode=sandbox | max_per_txn=0 | refund=false
- grant: data_delete | hard_delete=false | max_rows=100
- grant: data_export | pii=false | max_rows=10000
- grant: outbound_messages | live=false | max_per_hour=0
- grant: auth_crypto | custom_crypto=false
- grant: secrets | read_values=false

## Điểm dừng bắt buộc về hành động

- Gửi tin thật: không bật `OUTBOUND_LIVE`/`outbound_enabled`; T-406 vẫn chờ người.
- Miễn trừ (`— Miễn:`) MUST cần lời duyệt của chủ dự án (LOOP-STOP-024) → `loop defer`; "Không áp dụng" có điều kiện kiểm được thì phiên
  chính tự ghi kèm D-NNN.
- Ghi `.env*` (T-009) và gỡ hook/agent/lệnh (T-108) bị chặn bởi quyền/guard → người làm.
- Ruleset/required check/environment trên GitHub, dịch vụ trả phí, khoá thật, hạ tầng production → người (T-540, T-541).
- Chữ ký GO-NO-GO §5 và lý do "không áp dụng" của hàng `perf` (và `attack` nếu không làm được) → người (T-542).
- Sửa `xt.yaml` (khoá `migration_check`/`rollback`/`acceptance`/`attack`), CI, hook: cho chạy, nêu lý do trong commit/PR; không nới cổng.

## Thứ tự & lý do

1. (a) Sổ audit trước: không có sổ thì hàng audit FAIL và `loop next-step` không cho đi tiếp; 🔴 có test tái hiện trước khi sửa.
2. (b) MUST theo nhóm tiền tố: nhóm "Không áp dụng" trước (giảm số mục nhanh, mỗi điều kiện có test chống lệch), rồi nhóm tài liệu/quy
   trình (rẻ), rồi nhóm mã. Mỗi nhóm một PR.
3. (c) Sàn M/L sau khi sửa 🔴/🟠 (sửa có thể làm lệch format/coverage).
4. (d) Thiết kế đầy đủ: blueprint đòi SPEC (WF-SDD, PM-SPEC), hợp đồng API (STD-API-001, BE-API-001), THREAT-MODEL theo mẫu (SEC-TM).
   C4 nằm trong T-518 (ARC-STYLE-001).
5. (e) Refactor chỉ những gì sổ audit nhóm CODE/ARCH ghi, giữ hành vi bằng test.
6. (f) Hiệu năng: **không có task** — chưa có số đo (không SLO, không field, không bản chạy production); quyết định ở T-542.
7. (g) Từng hàng BLOCKER của release-check thành task; làm sớm theo thứ tự chạy ở tóm tắt.

## Task

### Lát A — Sổ audit: 🔴 rồi 🟠 (a)

- [x] `T-501` Chạy `/audit full` 13 nhóm (ARCH, SEC, CODE, TEST, PERF, A11Y, DEP, CI, DOC, DATA, CFG, XFEAT, HAR) trên 422 file → sổ `docs/ops/AUDIT-STATUS.md` + báo cáo; xác minh đối kháng mọi 🔴/🟠; công cụ thiếu ghi rõ trong sổ; nạp sẵn phát hiện đã biết: `harness-check` đỏ (`permissions.ask` có 3 mục force-push, `coordinator.md` có tool ghi/Agent), `xt.py checks` đỏ ở license-check (thiếu `license-allow.json`, công cụ cho Python — dự án Node) (H-001; topo: audit; files: docs/ops/AUDIT-STATUS.md, docs/ops/) — Gate: `python3 .xtemplates/scripts/xt.py audit check docs/ops/AUDIT-STATUS.md`
- [ ] `T-502` Sửa mọi 🔴 của sổ: mỗi lỗi một test tái hiện đỏ trước khi sửa, cập nhật trạng thái trong sổ; sổ > ~15 việc → lập PLAN-harden kế thay vì nhồi vào đây (H-002; sau: T-501; topo: review; exec: deep; files: theo sổ, docs/ops/AUDIT-STATUS.md) — Gate: `.xtemplates/scripts/dev-task.sh gate && python3 .xtemplates/scripts/xt.py audit check docs/ops/AUDIT-STATUS.md`
- [ ] `T-503` Sửa 🟠 và nợ review mở; mục không sửa trong đợt → `chấp nhận` có hạn + D-NNN, không để mở (H-003; sau: T-502; files: theo sổ, docs/ops/AUDIT-STATUS.md) — Gate: `python3 .xtemplates/scripts/xt.py audit check --strict docs/ops/AUDIT-STATUS.md`

### Lát B — MUST blueprint còn mở (b)

> Mỗi task: tick `[x]` kèm `— Kiểm: `<lệnh>`` chạy lại được (ưu tiên test trong `tests/config/` theo mẫu `baseline-floor.test.ts`),
> hoặc `[~] — Không áp dụng: <điều kiện>` có test đỏ khi điều kiện đổi. Mục phát hiện ra cần người → chuyển sang T-540/T-541/T-542
> bằng `loop defer` và ghi D-NNN, không tick bằng lời. Gate mỗi nhóm = lệnh test của nhóm + grep đỏ khi còn ID nào của nhóm ở `[ ]`.

- [ ] `T-510` 31 MUST không áp dụng cho sản phẩm hiện tại → `[~] — Không áp dụng:` kèm điều kiện kiểm được và một D-NNN chung: tiền (DB-MODEL-002, XC-UNITS-005/006, QA-UNIT-004, UX-CONTENT-006), realtime WebSocket/SSE (BE-RT-_), OAuth/OIDC (STD-API-005/006), MCP (AI-PROTO-_), khu vực công EU (STD-A11Y-005), nhiều dịch vụ (ARC-STYLE-006), cache ứng dụng (BE-CACHE-002/005/007), analytics/tracking (PM-METRIC-*, CMP-RIGHTS-003), thư viện/benchmark (QA-PERF-008), cassette (QA-DATA-008), biểu đồ (UX-VIZ-002), IaC cloud (OPS-IAC-001/003), index ngoài Postgres (DB-SEARCH-002) (H-010; files: BLUEPRINT.md, tests/config/baseline-floor.test.ts) — Gate: `npx vitest run tests/config/baseline-floor.test.ts && ! grep -qE '^- \[ \] .(DB-MODEL-002|XC-UNITS-(005|006)|QA-UNIT-004|UX-CONTENT-006|BE-RT-(001|002|003|004)|STD-API-(005|006)|AI-PROTO-(001|002|003|004)|STD-A11Y-005|ARC-STYLE-006|BE-CACHE-(002|005|007)|PM-METRIC-(003|004|005|006)|CMP-RIGHTS-003|QA-PERF-008|QA-DATA-008|UX-VIZ-002|OPS-IAC-(001|003)|DB-SEARCH-002)' BLUEPRINT.md`
- [ ] `T-511` Vòng lặp và hướng dẫn agent (27): LOOP-CTX/HARNESS/DESIGN/ORCH/STOP/OPT, XC-DOCAI-001/003/004 — tick bằng lệnh kiểm có sẵn (`xt.py harness-check`, `loop status`, test process-tooling); mục còn vướng di sản T-108 thì `loop defer` theo T-108 (H-011; files: BLUEPRINT.md, tests/config/process-tooling.test.ts) — Gate: `npx vitest run tests/config/process-tooling.test.ts && ! grep -qE '^- \[ \] .(LOOP-CTX-(001|002|006|017)|LOOP-HARNESS-(001|002|003|008)|LOOP-DESIGN-(001|003|004|008)|LOOP-ORCH-(001|003|004|009)|LOOP-STOP-(001|002|003|005)|LOOP-OPT-(001|002|003|005)|XC-DOCAI-(001|003|004))' BLUEPRINT.md`
- [ ] `T-512` Quản lý dự án và quy trình (25): `PROJECT.md` có ID `R-NNN`/`F-NNN`, MoSCoW, phát biểu vấn đề, bảng ISO/IEC 25010; `docs/RISKS.md` theo mẫu; gói bàn giao; DoR/DoD; mẫu PR có "cách đã xác minh"; file sức khoẻ cộng đồng (H-012; files: PROJECT.md, docs/RISKS.md, CONTRIBUTING.md, .github/pull_request_template.md, SECURITY.md, BLUEPRINT.md, tests/config/repo-docs.test.ts) — Gate: `npx vitest run tests/config/repo-docs.test.ts && ! grep -qE '^- \[ \] .(PM-REQ-(001|007|019)|PM-PLAN-(001|003|006)|PM-PRIO-(001|003|004|007)|PM-RISK-(001|003|006)|PM-HANDOVER-(002|009)|WF-TEAM-(003|004|005)|WF-REVIEW-(001|002|005)|STD-PROC-001|XC-OSS-(001|004|005))' BLUEPRINT.md`
- [ ] `T-513` Cổng, repo, tài liệu (14) + đổi 4 MUST đang tick bằng "Bằng chứng" (BASE-DEP-004, UX-A11Y-001, UX-RESP-001/002) sang `— Kiểm:` chạy lại được (hàng `unchecked_must`) (H-013; files: BLUEPRINT.md, README.md, .github/workflows/ci.yml, tests/config/gates.test.ts) — Gate: `npx vitest run tests/config/gates.test.ts tests/config/repo-docs.test.ts && ! grep -qE '^- \[ \] .(BASE-GATE-(005|006|008|009)|BASE-REPO-(001|005|013)|BASE-DOC-(005|006|007)|WF-DOC-(001|002)|STD-PROC-004|WF-GIT-010)' BLUEPRINT.md`
- [ ] `T-514` Phân tích tĩnh và build (18): Node/npm ghim, lint `prefer-nullish-coalescing` (BASE-DATA-003, test 0/""/[]/null), cấm `ignoreBuildErrors`, `test.only`/`skip` không lý do (H-014; files: eslint.config.mjs, tsconfig.json, next.config.mjs, src/, BLUEPRINT.md, tests/config/) — Gate: `npm run lint && npm run type-check && ! grep -qE '^- \[ \] .(FE-BUILD-(001|003|004|005)|XC-DX-(001|002|003|006)|QA-STATIC-(001|003|004|005)|QA-STRAT-(001|002|005|008)|BASE-DATA-003|PRF-WEB-002)' BLUEPRINT.md`
- [ ] `T-515` Phụ thuộc, license, SBOM, CI (22): chính sách license cho npm + test, SBOM bằng `npm sbom` (CycloneDX), ghim SHA action, `permissions:` tối thiểu, không nội suy input không tin cậy, Dependabot, theo dõi EOL (H-015; files: .github/, docs/ops/supply-chain.md, BLUEPRINT.md, tests/config/deps.test.ts, tests/config/dependency-hygiene.test.ts) — Gate: `npm run audit:deps && python3 .xtemplates/scripts/xt.py ci-check && npx vitest run tests/config/deps.test.ts tests/config/dependency-hygiene.test.ts && ! grep -qE '^- \[ \] .(BASE-DEP-(005|006|008)|CMP-LIC-(001|002|003|004)|SEC-SUPPLY-(003|006)|OPS-MAINT-(001|003|004|005)|WF-CI-(001|003|004|005)|SEC-SUPPLY-(001|009)|LOOP-CI-(001|004|008))' BLUEPRINT.md`
- [ ] `T-516` Bí mật (11): quét toàn lịch sử (cấu hình gitleaks đã có test; công cụ chạy ở CI `secret-scan.yml`), che bí mật trong log/lỗi/URL, quy trình rò rỉ, không mật khẩu mặc định trong compose (H-016; files: docker-compose.yml, docs/RUNBOOK.md, src/log/, BLUEPRINT.md, tests/config/gitleaks-config.test.ts, tests/log/) — Gate: `npx vitest run tests/config/gitleaks-config.test.ts tests/log && ! grep -qE '^- \[ \] .(BASE-SEC-002|SEC-SECRET-(001|007|011)|DB-SEC-004|AI-APP-008|AI-OBS-009|LOOP-FB-003|XC-DOCAI-005|OPS-IAC-004|SEC-INFRA-010)' BLUEPRINT.md`
- [ ] `T-517` Chiến lược test (20): coverage nhánh + ratchet (không hạ ngưỡng), test có assertion, E2E luồng chính tự tạo/dọn dữ liệu, race/idempotency/all-or-nothing, fixture không PII thật; QA-INT-001 (cùng major Postgres) ghi rõ PGlite vs Postgres 16 của CI (H-017; files: vitest.config.mts, playwright.config.ts, tests/, e2e/, BLUEPRINT.md) — Gate: `npm run test:coverage && ! grep -qE '^- \[ \] .(QA-COV-(001|002|004|008)|QA-E2E-(001|005|006)|QA-INT-(001|002)|FE-TEST-(001|002|003|006)|QA-UNIT-(007|008|010)|QA-DATA-(001|002|007)|PRF-WEB-006)' BLUEPRINT.md`
- [ ] `T-518` Kiến trúc và ADR (11): ADR kiểu kiến trúc + sơ đồ C4 mức 1–2, mục ADR đủ trường theo mẫu, test ranh giới module (lõi `src/` không import framework web, không vòng import, chỉ import điểm xuất công khai) thay cho depcruise/lint-imports đang thiếu (H-018; files: docs/adr/, docs/ARCHITECTURE.md, tests/config/architecture.test.ts, BLUEPRINT.md) — Gate: `npx vitest run tests/config/architecture.test.ts && ! grep -qE '^- \[ \] .(ARC-STYLE-(001|002|003)|ARC-MOD-(003|004|005|008)|ARC-ADR-(001|002|003|004))' BLUEPRINT.md`
- [ ] `T-519` Tích hợp, webhook, job (13): khoá idempotency, outbox, khử trùng theo id sự kiện/webhook, HMAC trên payload thô, `job_key`, retry hữu hạn + bảng lỗi, payload job tối thiểu có schema, chặn SSRF URL do người cấu hình (H-019; exec: deep; files: src/jobs/, src/inbox/, src/actions/, src/connectors/, src/providers/, tests/, BLUEPRINT.md) — Gate: `npx vitest run tests/jobs tests/inbox tests/actions tests/connectors tests/providers && ! grep -qE '^- \[ \] .(ARC-INT-(001|003|005|008)|BE-INT-(002|004|007|010)|BE-JOB-(001|003|004|007)|SEC-WEB-008)' BLUEPRINT.md`
- [ ] `T-520` Bền bỉ và CSDL (17): timeout mọi client, retry có giới hạn, tắt êm SIGTERM, giới hạn pool + `statement_timeout`, index đường nóng, transaction không gọi mạng, rate limit endpoint công khai (H-020; exec: deep; files: src/db/, src/server/, src/http/, instrumentation.ts, drizzle/, tests/db, tests/server, tests/http, BLUEPRINT.md) — Gate: `npx vitest run tests/db tests/server tests/http tests/jobs && ! grep -qE '^- \[ \] .(ARC-RES-(001|002|005|009)|BE-REL-(001|003|004|006)|XC-PERF-006|DB-PERF-(001|004|005|008)|DB-TX-(001|002|003)|FE-STATE-005)' BLUEPRINT.md`
- [ ] `T-521` Bảo mật web (18): không DOM sink chưa sanitize, allowlist scheme URL, CSP nonce, CSRF cho Server Action/form, kiểm file upload/tải (magic bytes, tên do server sinh, ngoài webroot, authz), `Cache-Control: private`, authz ở server cho route bảo vệ (H-021; sau: T-562; topo: review; files: app/, src/http/, src/evidence/, proxy.ts, tests/security, tests/http, tests/evidence, BLUEPRINT.md) — Gate: `npx vitest run tests/security tests/http tests/evidence && npm run build && npx playwright test e2e/security-headers.spec.ts && ! grep -qE '^- \[ \] .(SEC-WEB-(001|004)|FE-SEC-(001|002|003|005)|FE-FORM-010|PRF-WEB-004|BE-FILE-(001|003|004|005)|BE-CACHE-001|FE-RENDER-(002|005)|FE-STATE-008|BE-API-(003|009))' BLUEPRINT.md`
- [ ] `T-522` Phân quyền và cô lập workspace (6): test authz đặt tên API1 (BOLA)/API5 (BFLA) cho mọi dịch vụ theo workspace, tìm kiếm/RAG lọc theo quyền, vai trò DB riêng không owner; DB-SEC-007 (RLS): quyết bằng `loop decide` (RLS có migration lùi, hay cô lập tầng ứng dụng + Không áp dụng có điều kiện) (H-022; topo: review; exec: deep; files: src/workspaces/, src/search/, drizzle/, tests/security, tests/auth-integration, tests/workspaces, tests/search, BLUEPRINT.md) — Gate: `npx vitest run tests/security tests/auth-integration tests/workspaces tests/search && ! grep -qE '^- \[ \] .(STD-SEC-004|QA-INT-006|DB-SEARCH-003|AI-RAG-001|DB-SEC-(002|007))' BLUEPRINT.md`
- [ ] `T-523` Log, audit trail, quan sát trong ứng dụng (14): sự kiện bảo mật có trường chuẩn (UTC), audit trail hành động nhạy cảm, metric RED, `/healthz` + readiness, che PII/bí mật, span/ngân sách token AI, ngắt mạch chi phí, trần concurrency (H-023; files: src/log/, src/ai/, app/api/health/, tests/log, tests/ai, tests/server, BLUEPRINT.md) — Gate: `npx vitest run tests/log tests/ai tests/server && ! grep -qE '^- \[ \] .(SEC-LOG-(001|002|007)|CMP-AUDIT-002|OPS-OBS-(003|006|008)|CMP-PRIV-008|AI-OBS-(001|003|004)|OPS-COST-(003|004|005))' BLUEPRINT.md`
- [ ] `T-524` Tiếp cận và design system (16): khai WCAG 2.2 AA trong PROJECT.md, axe tag tới `wcag22aa` trên mọi trang chính, bàn phím/focus, nhãn ô nhập, token một nguồn, không hard-code màu, font có subset tiếng Việt, giảm chuyển động, `assets/CREDITS.md` (H-024; files: app/, app/globals.css, contrast-pairs.txt, e2e/a11y-responsive.spec.ts, docs/assets/, PROJECT.md, BLUEPRINT.md) — Gate: `python3 .xtemplates/scripts/xt.py contrast app/globals.css --pairs contrast-pairs.txt && npm run build && npx playwright test e2e/a11y-responsive.spec.ts && ! grep -qE '^- \[ \] .(STD-A11Y-(001|002)|UX-A11Y-(002|003|011)|UX-DS-(001|002|003|006)|UX-VISUAL-(001|002|006|007)|UX-RESP-005|QA-E2E-003|FE-FORM-002)' BLUEPRINT.md`
- [ ] `T-525` Trạng thái màn hình, form, nội dung, i18n (15): đủ 4 trạng thái, lỗi không lộ chi tiết, nút gửi vô hiệu khi chạy, dialog xác nhận hành động không hoàn tác, một schema form client+server, định dạng số/ngày theo locale, kiểm file chuỗi (H-025; sau: T-524; files: app/, src/, e2e/, BLUEPRINT.md) — Gate: `npm run build && npm run e2e && ! grep -qE '^- \[ \] .(UX-STATE-(001|005|006|008)|UX-CONTENT-(001|002|005)|FE-FORM-(001|007)|XC-I18N-(001|003|005|009)|XC-UNITS-(001|009))' BLUEPRINT.md`
- [ ] `T-526` Render, state và ngân sách tài nguyên (15): chế độ render theo route, không đọc cookie/`Date.now()` trong hàm cache, một lớp fetch + invalidation, ngân sách bundle trong repo chặn build, script bên thứ ba không chặn render, chỉ số hiệu năng chính + ngân sách (con số do T-542 chốt nếu cần người), baseline tài nguyên; FE-PERF-002 cần Lighthouse (thiếu) → thêm phụ thuộc dev hoặc `loop defer` kèm D-NNN (H-026; files: app/, next.config.mjs, docs/, tests/config/web-hygiene.test.ts, BLUEPRINT.md) — Gate: `npm run build && npx vitest run tests/config/web-hygiene.test.ts && ! grep -qE '^- \[ \] .(FE-RENDER-(001|003)|FE-STATE-(001|003)|FE-PERF-(002|004|009)|PRF-WEB-001|XC-PERF-(001|003|004)|XC-GREEN-(001|002|005|007))' BLUEPRINT.md`
- [ ] `T-527` Ứng dụng AI, guardrail, eval, RAG (21): đầu ra có schema, `max_tokens` + timeout, dữ liệu ngoài trong ranh giới, guardrail tất định ở server, che PII trước khi gửi mô hình, eval ≥ 50 câu có phiên bản (đã có `docs/eval/qa-v1`), CI không gọi mô hình thật, xoá tài liệu lan sang index (H-027; files: src/ai/, src/search/, src/knowledge/, docs/eval/, tests/ai, tests/eval, tests/search, tests/knowledge, BLUEPRINT.md) — Gate: `npx vitest run tests/ai tests/eval tests/search tests/knowledge && ! grep -qE '^- \[ \] .(AI-APP-(003|006|007)|AI-GUARD-(001|004|005|008)|AI-EVAL-(001|002|004|008)|AI-RAG-(002|004|006)|AI-DATA-(001|003|004|008)|CMP-PRIV-010|DB-SEARCH-(001|004))' BLUEPRINT.md`
- [ ] `T-528` Tác tử AI và minh bạch với người dùng (19): tác dụng phụ qua sổ hành động + `waiting_approval`, allowlist tool/tham số, ngân sách 5 chiều, kết quả tool là dữ liệu không tin cậy, nhãn "do AI tạo", output AI render như dữ liệu; CMP-AI-002/003/006 (H-028; sau: T-527; topo: review; files: src/ai/, src/actions/, app/, tests/ai, tests/actions, BLUEPRINT.md) — Gate: `npx vitest run tests/ai tests/actions && ! grep -qE '^- \[ \] .(AI-AGENTIC-(003|006|007|008)|AI-AGENT-(002|003|004|007)|SEC-AI-(001|002|005|007)|UX-AI-(001|002|004|007)|CMP-AI-(002|003|006))' BLUEPRINT.md`
- [ ] `T-529` Dữ liệu cá nhân trong sản phẩm (11): `docs/compliance/data-inventory.csv`, quyền chủ thể (xuất/xoá/rút đồng ý) là luồng có test, thời hạn lưu do job thực thi, xoá tài khoản lan mọi bản sao, bản ghi đồng ý (H-029; files: docs/compliance/, src/retention/, src/evidence/, tests/retention, tests/evidence, tests/config/data-classification.test.ts, BLUEPRINT.md) — Gate: `npx vitest run tests/retention tests/evidence tests/config/data-classification.test.ts && ! grep -qE '^- \[ \] .(STD-PRIV-(002|004|005)|CMP-PRIV-(001|005)|CMP-RIGHTS-(001|004|007)|CMP-VN-(001|007)|PM-REQ-009)' BLUEPRINT.md`
- [ ] `T-530` Khai báo pháp lý và chuẩn (12): luật/chuẩn áp dụng có số hiệu + ngày hiệu lực từ nguồn sống (researcher, ghi ngày; không xác minh được → "(chưa xác minh)"), ASVS 5.0 mức nhắm, chuyển dữ liệu ra ngoài VN, quy trình thông báo vi phạm, ROPA/sổ nhà cung cấp/sổ sự cố; CMP-INTL "Không áp dụng" chỉ khi điều kiện "không phục vụ người dùng EU/UK" được ghi D-NNN (H-030; files: PROJECT.md, docs/compliance/, docs/ops/incident-response.md, BLUEPRINT.md, tests/config/repo-docs.test.ts) — Gate: `npx vitest run tests/config/repo-docs.test.ts && ! grep -qE '^- \[ \] .(STD-PRIV-001|PM-RISK-007|CMP-VN-(004|006)|CMP-INTL-(002|005|006|007)|CMP-AUDIT-(003|007|010)|STD-SEC-001)' BLUEPRINT.md`
- [ ] `T-531` Vận hành, migration, phát hành (20): `docs/ops/RUNBOOK.md` (rollback, khôi phục từng kho có lệnh), smoke sau deploy, ứng phó sự cố, script backup theo lịch + khôi phục thử vào DB tách biệt, chặn sửa migration đã áp (băm), expand/contract, SLI availability; định danh phát hành: `VERSION`/SemVer, tag `vX.Y.Z` do workflow `release-tag.yml` tạo sau GO (H-031; files: docs/ops/, docs/RUNBOOK.md, scripts/, .github/workflows/release*.yml, tests/config/runbook.test.ts, tests/config/deploy.test.ts, tests/db, BLUEPRINT.md) — Gate: `npx vitest run tests/config/runbook.test.ts tests/config/deploy.test.ts tests/db && ! grep -qE '^- \[ \] .(WF-DOC-008|WF-REL-(004|007)|OPS-IR-(001|004|010)|OPS-DR-008|OPS-DEPLOY-(003|004)|DB-BACKUP-(002|003)|DB-MIG-(003|008|011)|OPS-SLO-001|BASE-REPO-006|STD-PROC-002|WF-REL-(001|003)|XC-OSS-007)' BLUEPRINT.md`

#### Việc chờ người (`xt.py loop defer --task <ID> --reason …` — không nằm trên đường chính)

- [ ] `T-009` Tạo `.env.example` (BASE-CFG-003), gồm `BLOB_DIR`, `AI_*`, `OUTBOUND_LIVE` — cần người: quy tắc quyền chặn ghi `.env*` (D-004) (files: .env.example, tests/config/env-example.test.ts) — Gate: `npx vitest run tests/config/env-example.test.ts`
- [ ] `T-108` Gỡ 8 tệp hook cũ, 10 agent và 13 lệnh cũ của projects-template — cần người (ADR-0003) (files: .claude/hooks/, .claude/agents/, .claude/commands/) — Gate: `npx vitest run tests/config/process-tooling.test.ts`
- [ ] `T-540` Quản trị GitHub (10, gồm lớp A): áp ruleset nhánh chính từ `.github/rulesets/`, required check, không bypass, environment production có cổng, reviewer thứ hai/CODEOWNERS (WF-TEAM-007 chỉ khi ≥ 2 người); agent soạn sẵn `xt.py admin-plan --script` — cần người quản trị repo (H-040; files: .github/rulesets/, BLUEPRINT.md) — Gate: `! grep -qE '^- \[ \] .(BASE-GATE-(007|019)|BASE-REPO-008|WF-GIT-(001|002|003)|WF-REVIEW-007|WF-ENV-008|PM-PLAN-005|WF-TEAM-007)' BLUEPRINT.md`
- [ ] `T-541` Hạ tầng và dịch vụ thật (29): error tracking (GlitchTip tự host hoặc dịch vụ), log tập trung ngoài máy, kho bí mật production, backup ngoài máy + 3-2-1 + mã hoá + tách quyền xoá, TLS `verify-full` tới DB, mạng nội bộ cho DB, quét image (cần Docker daemon), artifact bất biến + rollback một bước, staging/preview, cảnh báo burn rate có thử kích hoạt, ngân sách cloud, CWV field, bàn giao tài khoản — cần người: tài khoản/khoá/hạ tầng chỉ chủ dự án có; agent soạn tài liệu + script tự host (H-041; files: docs/ops/, BLUEPRINT.md) — Gate: `! grep -qE '^- \[ \] .(BASE-ERR-011|OPS-OBS-001|SEC-LOG-006|SEC-SECRET-005|DB-BACKUP-004|OPS-DR-(003|004|007)|DB-SEC-003|SEC-INFRA-(001|002|003)|STD-SEC-007|BASE-DEP-009|WF-ENV-(006|010|012)|PRF-WEB-(005|008|009)|OPS-DEPLOY-(001|002)|OPS-SLO-(004|005|006)|OPS-COST-001|FE-PERF-001|PM-HANDOVER-(004|005))' BLUEPRINT.md`
- [ ] `T-542` Quyết định và chữ ký của chủ dự án (8 + hàng release-check): RPO/RTO (DB-BACKUP-001), phân loại rủi ro AI (CMP-AI-001, lớp B), OPS-IR-006/OPS-IAC-006 (lớp B), kiểm luồng bằng trình đọc màn hình (STD-A11Y-004), load test/số đo hiệu năng (QA-PERF-002/006/007); ký lý do "không áp dụng" cho hàng `perf` của release-check (đề xuất ở §Hàng release-check) — cần người (H-042; files: BLUEPRINT.md, docs/ops/) — Gate: `! grep -qE '^- \[ \] .(DB-BACKUP-001|CMP-AI-001|OPS-IR-006|OPS-IAC-006|QA-PERF-(002|006|007)|STD-A11Y-004)' BLUEPRINT.md`

### Lát C — Sàn Gate M/L (c)

- [ ] `T-550` Chạy đủ sàn M/L (format_check, coverage, typecheck, e2e) và sửa phần đỏ, không hạ ngưỡng (H-050; sau: T-503; files: theo kết quả) — Gate: `python3 .xtemplates/scripts/xt.py floor --run`

### Lát D — Thiết kế đầy đủ theo quy mô M (d)

- [ ] `T-560` SPEC cho từng tính năng MVP theo mẫu khung (`docs/specs/SPEC-<slug>.md`): tiêu chí chấp nhận `AC-xx` dạng Given/When/Then, mục "Ca biên" đủ nhóm (rỗng/null, cực trị, đồng thời, quyền, UTC), spec hở → D-NNN; người duyệt SPEC độc lập cho phạm vi nhạy cảm (WF-SDD-010) để ở T-542 nếu blueprint đòi (H-060; files: docs/specs/, PROJECT.md, BLUEPRINT.md) — Gate: `! grep -qE '^- \[ \] .(WF-SDD-(001|002|003)|PM-SPEC-(001|003|004|020))' BLUEPRINT.md`
- [ ] `T-561` `docs/API-CONTRACT.md` theo mẫu + OpenAPI 3.1 cho 3 route handler (`/api/health`, `/api/webhooks/socialapi/[connectionId]`, `/api/auth/*` tham chiếu Better Auth) và bảng Server Action; test so OpenAPI đã commit với handler để chặn thay đổi phá vỡ (thay oasdiff đang thiếu); idempotency HTTP (H-061; files: docs/API-CONTRACT.md, docs/openapi.yaml, tests/config/api-contract.test.ts, BLUEPRINT.md) — Gate: `npx vitest run tests/http tests/config/api-contract.test.ts && ! grep -qE '^- \[ \] .(STD-API-(001|008)|BE-API-(001|008)|QA-INT-007|STD-PROC-003)' BLUEPRINT.md`
- [ ] `T-562` Cập nhật `docs/THREAT-MODEL.md` theo mẫu khung: DFD có ranh giới tin cậy (thêm kho bằng chứng, cổng AI, sổ hành động gửi tin), mức rủi ro khả năng × tác động, mọi mối Cao trỏ ID biện pháp, bảng OWASP A01–A10:2025; chấp nhận rủi ro (SEC-TM-007) là việc người (H-062; files: docs/THREAT-MODEL.md, tests/config/threat-model.test.ts, BLUEPRINT.md) — Gate: `npx vitest run tests/config/threat-model.test.ts && ! grep -qE '^- \[ \] .(SEC-TM-(001|003|005|006)|STD-SEC-003)' BLUEPRINT.md`

### Lát E — Refactor có Gate (e)

- [ ] `T-570` Refactor các phát hiện nhóm CODE/ARCH của sổ audit (trùng lặp, module quá lớn, vi phạm ranh giới từ T-518), mỗi thay đổi giữ hành vi bằng test có sẵn; không có phát hiện → `[~] — Bỏ: sổ không có mục CODE/ARCH` (H-070; sau: T-503, T-518; files: theo sổ) — Gate: `.xtemplates/scripts/dev-task.sh gate`

### Lát F — Hiệu năng (f)

Không có task: chưa có số đo đỏ (không SLO, không FIELD, không bản production; k6/lighthouse không có trong máy). Theo ADR-0048 `/optimize`
chỉ chạy khi có số. Quyết định hàng `perf` nằm ở T-542.

### Lát G — Hàng BLOCKER của release-check (g)

- [ ] `T-580` Khai `migration_check: "npx vitest run tests/db/schema.test.ts tests/db/conversations.test.ts"` trong xt.yaml (lý do trong PR: ADR-0062, cổng production); thêm `tests/db/migration-data.test.ts`: dữ liệu tổng hợp ở mọi bảng → lùi từng migration rồi tiến lại, bảng cũ giữ nguyên số dòng/nội dung (yêu cầu "trên bản sao dữ liệu"), rồi đưa file mới vào khoá (H-080; files: xt.yaml, tests/db/migration-data.test.ts) — Gate: `npx vitest run tests/db/schema.test.ts tests/db/conversations.test.ts tests/db/migration-data.test.ts`
- [ ] `T-581` Diễn tập rollback: `tests/db/rollback-drill.test.ts` (dữ liệu ở HEAD → chạy `.down.sql` các migration mới hơn mốc phát hành trước → sổ `__drizzle_migrations` khớp, dữ liệu bảng cũ còn, migrator dựng lại được); cập nhật RUNBOOK §Rollback (bỏ "chưa diễn tập" cho phần DB); khai `rollback: "npx vitest run tests/db/rollback-drill.test.ts"`. Nửa artifact (image/tag cũ) cần đích deploy → T-541 (H-081; sau: T-580; files: tests/db/rollback-drill.test.ts, docs/RUNBOOK.md, xt.yaml) — Gate: `npx vitest run tests/db/rollback-drill.test.ts`
- [ ] `T-582` Tấn công thử tự động trên mã chạy cục bộ: `tests/security/attack/` — BOLA/BFLA chéo workspace, CSRF (Origin) cho Server Action, XSS lưu trữ trong nội dung hội thoại/tài liệu render, giả chữ ký và phát lại webhook, SSRF URL cấu hình, dò mật khẩu bị 429; khai `attack: "npx vitest run tests/security"` (H-082; sau: T-522; topo: review; files: tests/security/attack/, xt.yaml) — Gate: `npx vitest run tests/security`
- [ ] `T-583` Bộ nghiệm thu độc lập: `acceptance-author` viết `tests/acceptance/*.test.ts` theo `AC-xx` của SPEC (PGlite, không cần mạng), khoá bằng `xt.py acceptance lock --spec <SPEC> --author acceptance-author`; khai `acceptance: "npx vitest run tests/acceptance"` và `acceptance_paths: "tests/acceptance"` (H-083; sau: T-560; files: tests/acceptance/, xt.yaml) — Gate: `npx vitest run tests/acceptance && python3 .xtemplates/scripts/xt.py acceptance check`
- [ ] `T-584` Kiểm tổng phần agent làm được trước cổng ký: mọi lệnh `— Kiểm:` của blueprint xanh và sổ audit `--strict` xanh; sau đó sang Bước 5 (`release-check --json` → `loop next-step`) (H-084; sau: T-503, T-510, T-511, T-512, T-513, T-514, T-515, T-516, T-517, T-518, T-519, T-520, T-521, T-522, T-523, T-524, T-525, T-526, T-527, T-528, T-529, T-530, T-531, T-550, T-560, T-561, T-562, T-570, T-580, T-581, T-582, T-583; XT_RECORD_TIMEOUT=3600) — Gate: `python3 .xtemplates/scripts/xt.py blueprint-status BLUEPRINT.md --run && python3 .xtemplates/scripts/xt.py audit check --strict docs/ops/AUDIT-STATUS.md`

#### Hàng release-check: đề xuất và trạng thái kiểm lệnh (2026-11-23)

| Hàng              | Đề xuất                                                                                                                                                                                                                                                          | Đã chạy thử?                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `migration_check` | `npx vitest run tests/db/schema.test.ts tests/db/conversations.test.ts` (tiến/lùi từng migration 0000–0019 trên PGlite, migrator thật dựng lại) + file dữ liệu ở T-580                                                                                           | Có: 31 + 8 test xanh (~50 s + ~11 s). File dữ liệu: chưa có |
| `rollback`        | `npx vitest run tests/db/rollback-drill.test.ts` (phần DB); phần artifact chờ đích deploy (T-541)                                                                                                                                                                | Chưa: file do T-581 tạo                                     |
| `acceptance`      | `npx vitest run tests/acceptance` + `acceptance_paths`; tuỳ chọn `acceptance_report` JUnit (`--reporter=junit --outputFile=…`, chưa kiểm cờ với vitest 5.1)                                                                                                      | Chưa: thư mục do T-583 tạo                                  |
| `attack`          | **Làm:** `npx vitest run tests/security` (mở rộng ở T-582). ZAP baseline chỉ khi có Docker daemon (hiện không có)                                                                                                                                                | Có (bản hiện tại): 3 file, 36 test xanh                     |
| `perf`            | **Đề nghị người ký "không áp dụng" cho bản phát hành đầu**: tự host một nhóm, chưa có SLO/lưu lượng/số field, k6/lighthouse không có; ADR-0048 cấm tối ưu không số. Khi có số field hoặc chủ dự án chốt SLO → khai `perf` (k6 có `thresholds`) và mở `/optimize` | Không áp dụng                                               |

Ghi chú: release-check còn hàng `go_no_go` (hiện N/A SHOULD vì chưa có `VERSION`); khi T-531 thêm `VERSION`, GO-NO-GO của bản đó cần
người ký §5 (`release_signoff` trống = người ký).

## Phụ thuộc ngoài

| Việc                                                  | Bên ngoài                   | Ngày cam kết | Kế hoạch B                                                 |
| ----------------------------------------------------- | --------------------------- | ------------ | ---------------------------------------------------------- |
| T-540 ruleset/required check                          | quản trị repo GitHub        | chưa có      | giữ `merge_autonomy: L1` (người merge)                     |
| T-541 backup ngoài máy, error tracking, log tập trung | chủ dự án (hạ tầng tự host) | chưa có      | tài liệu + script tự host sẵn trong repo, mục MUST giữ mở  |
| T-542 RPO/RTO, phân loại AI, ký N/A perf              | chủ dự án                   | chưa có      | release-check giữ NO-GO ở các hàng đó                      |
| Công cụ audit thiếu (gitleaks, semgrep, osv-scanner…) | cài trong môi trường        | —            | sổ ghi "thiếu công cụ"; CI có secret-scan/codeql/dep-audit |

## Ước lượng

| Task                      | P50                   | P90         |
| ------------------------- | --------------------- | ----------- |
| T-501                     | 0,5 ngày              | 1 ngày      |
| T-502/T-503               | tuỳ sổ (1 ngày)       | 3 ngày      |
| T-510–T-531 (22 nhóm)     | 0,3–0,5 ngày/nhóm     | 1 ngày/nhóm |
| T-550, T-560–T-562, T-570 | 0,5 ngày mỗi task     | 1 ngày      |
| T-580–T-583               | 0,3–0,5 ngày mỗi task | 1 ngày      |
| T-584                     | 0,2 ngày              | 0,5 ngày    |

Tổng: P50 ≈ 12 ngày làm · P85 ≈ 20 ngày (không cộng P50 làm ngày hứa; việc chờ người không tính).
