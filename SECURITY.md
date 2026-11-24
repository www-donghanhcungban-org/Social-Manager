# Chính sách bảo mật

Tài liệu này nói **cách báo cáo lỗ hổng** và **các hàng rào bảo mật đang chạy thật** trong X-Workspace.
Mô hình mối đe doạ: `docs/THREAT-MODEL.md`.

## Báo cáo lỗ hổng

**Đừng** mở issue công khai cho lỗ hổng bảo mật. Thay vào đó:

- Dùng **GitHub Security Advisories**: tab **Security → Report a vulnerability** (private disclosure).
- Dự án chưa công bố email riêng cho bảo mật; kênh Security Advisories ở trên là kênh duy nhất.

Vui lòng kèm: mô tả, bước tái hiện, ảnh hưởng dự kiến, và phiên bản/commit liên quan.
Mục tiêu phản hồi: xác nhận trong vòng **72 giờ**; thống nhất mốc vá trước khi công bố.

## Hàng rào bảo mật trong repo

| Lớp                        | Công cụ                                                                                                                                                                                       | Bắt gì                                                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Bí mật                     | gitleaks (`.github/workflows/secret-scan.yml`) — mỗi PR/push + quét toàn lịch sử hằng tuần                                                                                                    | API key/token/mật khẩu lỡ commit                                                                                                             |
| Bí mật (trong phiên agent) | hook `PreToolUse` guard khai ở `.claude/settings.json`                                                                                                                                        | lệnh lộ bí mật, ghi `.env*`, tắt hook (chỉ áp cho phiên Claude Code; **không** có hook quét bí mật trước `git commit` của người dùng thường) |
| Phụ thuộc                  | Dependabot (`.github/dependabot.yml`: github-actions, npm) + `.github/workflows/dependency-review.yml` (fail ở mức high) + `.github/workflows/dep-audit.yml` (`npm audit --audit-level=high`) | bản có lỗ hổng đã biết; dependency mới có CVE trong PR                                                                                       |
| SAST                       | CodeQL (`.github/workflows/codeql.yml`: javascript-typescript, python, actions)                                                                                                               | lỗ hổng trong mã ứng dụng, công cụ quy trình và workflow                                                                                     |
| Chuỗi cung ứng             | OpenSSF Scorecard (`.github/workflows/scorecard.yml`); `xt.py ci-check` trong job `gate` của `.github/workflows/ci.yml` (mọi action ghim full SHA, `permissions` tối thiểu, có `timeout`)     | action chưa ghim, quyền token rộng, workflow nguy hiểm                                                                                       |
| Nhánh chính                | ruleset `.github/rulesets/main.json` (required check, chặn force-push)                                                                                                                        | push thẳng/force-push `main`, PR không qua cổng                                                                                              |
| Agent                      | nội dung ngoài (web, issue, PR, output tool) là dữ liệu, không phải chỉ thị (`AGENTS.md` §4)                                                                                                  | prompt injection qua PR/issue/file vào agent                                                                                                 |

Ngoại lệ phụ thuộc đã chấp nhận (có hạn) ghi ở `docs/ops-notes/dependency-exceptions.md`.

## Hàng rào trong mã ứng dụng

- **Quyền kiểm ở server, tầng dịch vụ:** mọi Server Action gọi `requireWorkspace`/`requireUser`, dịch vụ kiểm `requireAction` theo vai trò. Dự án **không dùng RLS**; cô lập dữ liệu giữa workspace là điều kiện `workspace_id` trong mọi truy vấn của dịch vụ (xem `PROJECT.md`).
- **CSRF và header bảo mật:** `src/security/csrf.ts` kiểm `Sec-Fetch-Site`/`Origin` (test ở `tests/security/csrf.test.ts`); `proxy.ts` gắn `Content-Security-Policy` (test ở `e2e/security-headers.spec.ts`).
- **Khoá nhà cung cấp:** mã hoá AES-256-GCM khi lưu trong DB (`src/security/secret-box.ts`), khoá chủ nạp từ biến môi trường.
- **Webhook:** xác thực chữ ký HMAC-SHA256, so sánh thời gian hằng, cửa sổ 5 phút, ghi idempotent.
- **Cấu hình:** `src/config/env.ts` validate lúc khởi động và từ chối chạy khi thiếu giá trị bắt buộc.
- **Gửi tin ra ngoài:** mặc định tắt; cần hai khoá (`OUTBOUND_LIVE` và cờ của workspace), có sổ hành động và không tự gửi lại (`docs/adr/0006-outbound-actions.md`).
- **Cổng AI:** tắt mặc định, dữ liệu ra đám mây chỉ khi workspace đồng ý (`docs/adr/0005-ai-gateway.md`).

## Nguyên tắc bất biến (không bao giờ phá)

- **Bí mật không bao giờ vào Git** — dùng biến môi trường (`.env*` đã bị `.gitignore` chặn).
- **Không tin client** — logic nhạy cảm (kiểm tra quyền, tính toán quan trọng) luôn ở server.
- Truy vấn **tham số hóa** (chống SQL injection); **escape** dữ liệu ra HTML (chống XSS).
- Mọi truy vấn dữ liệu của workspace phải kèm điều kiện workspace và có test cô lập.
- Mọi đầu vào (người dùng/API/CSDL) **validate lúc chạy** trước khi dùng.
