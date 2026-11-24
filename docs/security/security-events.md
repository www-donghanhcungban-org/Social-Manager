# Sự kiện bảo mật và audit trail

Nguồn sự thật: `src/log/security-events.ts` (log có cấu trúc) và `src/audit/record.ts` (audit trail trong CSDL). Test `tests/log/security-events.test.ts` đối chiếu hai danh sách với bảng dưới đây; thêm sự kiện mà không ghi vào đây thì test đỏ.

## 1. Sự kiện bảo mật (một dòng log JSON, mức `info` khi thành công, `warn` khi bị từ chối)

Trường bắt buộc (schema: `docs/security/security-event.schema.json`): `timestamp` (UTC ISO-8601), `event`, `actor`, `target_type`, `target_id`, `outcome` (`success`/`denied`/`error`), `source_ip`, `user_agent`, `request_id`. Không ghi nội dung người dùng, mật khẩu, token, email thô (logger che email và số điện thoại; `actor` là id).

| Sự kiện                     | Khi nào                                           | Nơi phát                                  |
| --------------------------- | ------------------------------------------------- | ----------------------------------------- |
| `auth.login_succeeded`      | đăng nhập email/mật khẩu thành công               | `src/auth/auth.ts` (hook after)           |
| `auth.login_failed`         | sai email hoặc mật khẩu                           | `src/auth/auth.ts` (hook after)           |
| `auth.login_locked`         | tài khoản bị khoá tạm vì thử quá nhiều            | `src/auth/auth.ts` (hook before)          |
| `authz.denied`              | thao tác bị từ chối vì thiếu quyền (403)          | `src/http/errors.ts`                      |
| `input.invalid`             | đầu vào không hợp lệ bị từ chối (422)             | `src/http/errors.ts`                      |
| `webhook.signature_invalid` | webhook sai chữ ký/timestamp (401)                | `app/api/webhooks/socialapi/.../route.ts` |
| `ai.blocked`                | gọi AI đám mây khi workspace chưa cho phép        | `src/ai/gateway.ts`                       |
| `ai.budget_exceeded`        | gọi AI vượt ngân sách 24 giờ của workspace (100%) | `src/ai/gateway.ts`                       |

Chưa có (ghi nhận, không phải lỗ hổng): đăng xuất, đổi mật khẩu, MFA, token — ứng dụng chưa có chức năng đó (Better Auth dùng phiên cookie, chưa bật MFA). Lỗi TLS backend: Postgres/nhà cung cấp trong cùng mạng, lỗi kết nối vào log lỗi chung.

## 2. Audit trail (bảng `audit_events`, chỉ ghi thêm)

Mỗi dòng: `who` (`actor_id`), `what` (`action`), `target` (`target_type`, `target_id`), `when` (`created_at`, UTC), `where` (`source_ip`, `user_agent`, `request_id`), `result` (`outcome`), `reason`. Trigger CSDL `audit_events_append_only` từ chối UPDATE, DELETE và TRUNCATE với mọi vai trò. Thời hạn lưu: không xoá tự động (≥ 12 tháng theo NĐ 333/2026 — chưa xác minh điều khoản, xem `docs/compliance/`); xoá theo thời hạn chỉ qua job riêng có ghi nhận (chưa có job: dữ liệu giữ nguyên).

| Hành động                           | Khi nào                                  |
| ----------------------------------- | ---------------------------------------- |
| `workspace.retention_changed`       | owner đổi thời hạn lưu tin               |
| `workspace.ai_cloud_changed`        | owner bật/tắt gửi dữ liệu tới AI đám mây |
| `workspace.outbound_changed`        | owner bật/tắt gửi tin và hạn mức giờ     |
| `member.added`                      | thêm thành viên                          |
| `member.role_changed`               | đổi vai trò                              |
| `member.removed`                    | xoá thành viên hoặc tự rời               |
| `connection.created`                | tạo kết nối nguồn dữ liệu                |
| `connection.removed`                | xoá kết nối                              |
| `connection.webhook_secret_changed` | đặt/xoá secret ký webhook                |
| `account.added`                     | thêm tài khoản mạng xã hội               |
| `account.removed`                   | xoá tài khoản                            |
| `data.erased`                       | xoá hội thoại, bằng chứng hoặc dự án     |
| `data.exported`                     | xuất dữ liệu dự án                       |

Đồng hồ: các sự kiện ghi bằng `now()` của Postgres và `Date` của Node đều UTC; đồng bộ NTP là việc của máy chủ triển khai (ngoài mã, xem RUNBOOK).
