---
status: approved
approved_by: phiên chính (tự duyệt, ADR-0008, D-032)
approved_at: 2026-11-24
feature: F-001
requirements: [R-001, R-002]
---

# SPEC F-001 — Đăng ký, đăng nhập, workspace nhiều thành viên

Trạng thái: Approved for implementation

| Trường       | Giá trị                                                          |
| ------------ | ---------------------------------------------------------------- |
| ID tính năng | F-001 (yêu cầu gốc: R-001, R-002)                                |
| Phiên bản    | 2 — thay đổi: xem cuối file                                      |
| Chủ spec     | phiên chính · Duyệt bởi phiên chính (D-032) ngày 2026-11-24      |
| Hồ sơ/quy mô | web-app / M                                                      |
| Quy ước ID   | `AC-xx` là ID scenario; test ghi `F-001/AC-xx` (xem `README.md`) |

## 1. User story

Là chủ cửa hàng hoặc thành viên nhóm marketing, tôi muốn đăng ký, đăng nhập và làm việc trong workspace chung có vai trò owner/admin/member, để cả nhóm dùng chung dữ liệu mà người ngoài không đọc, không sửa, không biết dữ liệu đó tồn tại.

## 2. Tiêu chí chấp nhận

### AC-01 — Đăng ký tạo tài khoản, mật khẩu băm Argon2id

- Given người dùng chưa có tài khoản
- When đăng ký bằng email và mật khẩu ≥ 12 ký tự
- Then có bản ghi người dùng; mật khẩu lưu dạng PHC `argon2id` (m ≥ 19456, t ≥ 2, p = 1), không lưu bản rõ

### AC-02 — Tạo workspace: người tạo là owner trong cùng giao dịch

- Given người dùng đã đăng nhập
- When tạo workspace với tên 1–100 ký tự (chuẩn hoá NFC, cắt khoảng trắng)
- Then có workspace và người tạo là `owner`; lỗi giữa chừng thì không còn workspace mồ côi

### AC-03 — Đăng ký sai hoặc trùng (ca lỗi)

- Given email đã đăng ký, hoặc mật khẩu ngắn hơn 12 ký tự
- When đăng ký
- Then mật khẩu ngắn bị từ chối; email trùng (kể cả khác hoa/thường) không tạo thêm người dùng, không đổi mật khẩu, phản hồi giống email mới và không cấp phiên

### AC-04 — Sai mật khẩu nhiều lần bị giới hạn theo tài khoản (ca lỗi)

- Given một email đã sai mật khẩu quá 4 lần liên tiếp
- When thử đăng nhập tiếp trong thời gian chờ, kể cả bằng mật khẩu đúng
- Then nhận 429 `TOO_MANY_ATTEMPTS`; thời gian chờ bắt đầu 1 giây, tăng gấp đôi, trần 900 giây (không khoá vĩnh viễn); hết thời gian chờ thì đăng nhập được và bộ đếm về 0; email không tồn tại cho cùng chuỗi phản hồi; khoá một email không ảnh hưởng email khác; ngoài ra mỗi IP có hạn mức theo phút (429)

### AC-05 — Người ngoài không đọc, sửa hay biết tài nguyên của workspace khác (ca lỗi)

- Given người dùng B là owner workspace B, không thuộc workspace A
- When B dùng ID tài nguyên của A (kết nối, tài khoản, tin, bài) trong workspace B, hoặc gọi thẳng vào workspace A
- Then thao tác theo ID trả NotFound và dữ liệu A không đổi; thao tác ở cấp workspace A trả Forbidden ở dịch vụ, còn trang `/app/<A>` trả "không tìm thấy" (không lộ tên)

### AC-06 — Một bảng quyền duy nhất ở server quyết định vai trò

- Given vai trò `owner` > `admin` > `member` và người ngoài (`null`)
- When kiểm một hành động bằng `can(role, action)`
- Then member chỉ đọc/trả lời hộp thư, đăng bài, đọc kho bằng chứng; admin thêm quản lý kết nối và thành viên; chỉ owner đổi vai trò, xoá workspace, đổi cấu hình; người ngoài không làm được gì

### AC-07 — Luôn còn ít nhất một owner, kể cả song song

- Given workspace có một hoặc hai owner
- When hạ vai trò hoặc rời workspace (tuần tự hoặc hai owner cùng lúc)
- Then owner cuối cùng bị từ chối với `last_owner`; hai thao tác song song chỉ một thành công, luôn còn đúng ít nhất một owner

### AC-08 — Admin không nâng quyền người khác ngang hoặc hơn mình (ca lỗi)

- Given admin của workspace
- When thêm thành viên vai trò `admin`/`owner`, đổi vai trò, hoặc xoá admin/owner khác
- Then bị Forbidden, dữ liệu thành viên không đổi

### AC-09 — Phiên hết hiệu lực đúng lúc

- Given người dùng có phiên đang dùng
- When đăng xuất, phiên hết hạn, hoặc bị gỡ khỏi workspace
- Then cookie cũ không còn phiên; người bị gỡ bị từ chối ngay ở lần gọi kế tiếp

## 3. Ca biên

| Nhóm                  | Ca cụ thể                                                         | Hành vi mong đợi                                                     | AC                  |
| --------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------- |
| Rỗng/null             | mật khẩu rỗng/ngắn; tên workspace rỗng; actorId rỗng              | từ chối, không tạo gì                                                | AC-02, AC-03        |
| Cực đại/độ dài        | tên workspace > 100 ký tự; mật khẩu > 72 byte; 20 workspace/người | từ chối tên dài và workspace thứ 21; mật khẩu dài vẫn phân biệt được | AC-01, AC-02        |
| Trùng lặp/idempotency | đăng ký lại cùng email (kể cả khác hoa/thường)                    | không tạo người dùng thứ hai, không đổi mật khẩu                     | AC-03               |
| Song song             | hai owner cùng hạ nhau; nhiều lần sai mật khẩu cùng lúc           | còn đúng một owner; bộ đếm không mất cập nhật                        | AC-07, AC-04        |
| Mất mạng giữa chừng   | lỗi ở bước ghi owner khi tạo workspace                            | giao dịch hoàn tác, không workspace mồ côi                           | AC-02               |
| Thời gian/múi giờ     | bộ đếm sai cũ hơn 24 giờ; phiên hết hạn                           | bộ đếm bắt đầu lại; phiên hết hạn không dùng được; lưu `timestamptz` | AC-04, AC-09        |
| Quyền                 | người ngoài / member / admin / owner của workspace khác           | NotFound theo ID, Forbidden theo workspace, đúng bảng quyền          | AC-05, AC-06, AC-08 |
| Tiền/đơn vị           | —                                                                 | không áp dụng — tính năng không có số tiền hay đơn vị đo             | —                   |

## 4. Dữ liệu

| Thực thể         | Trường                            | Kiểu      | Ràng buộc                                    | Ai đọc/ghi                    |
| ---------------- | --------------------------------- | --------- | -------------------------------------------- | ----------------------------- |
| `user`           | `email`, `name`                   | text      | email duy nhất (chuẩn hoá thường)            | Better Auth                   |
| `account`        | `password`                        | text      | PHC argon2id                                 | Better Auth                   |
| `workspaces`     | `name`                            | text      | 1–100 ký tự, NFC                             | thành viên đọc; owner sửa     |
| `members`        | `workspace_id`, `user_id`, `role` | uuid/text | duy nhất (workspace, user); role ∈ 3 giá trị | dịch vụ `src/auth/members.ts` |
| `login_throttle` | `key_hash`                        | text      | HMAC của email, không lưu email rõ           | `src/auth/throttle.ts`        |

- Migration: `drizzle/` (mỗi tệp có `.down.sql`).

## 5. Giao diện / API

- `/api/auth/*` (Better Auth); Server Action của `/app` (tạo workspace) và trang workspace; mọi action lấy danh tính từ phiên (`requireUser`/`requireWorkspace`).
- UI: `/login` hai chế độ đăng nhập/đăng ký; lỗi chung không lộ email nào đã đăng ký; điều hướng bằng bàn phím được (e2e `a11y-behavior`).

## 6. Lỗi

| Mã lỗi                           | Khi nào                                       | HTTP/exit code                                  | Thông điệp cho người dùng              | AC           |
| -------------------------------- | --------------------------------------------- | ----------------------------------------------- | -------------------------------------- | ------------ |
| `PASSWORD_TOO_SHORT`             | mật khẩu < 12 ký tự                           | lỗi của `/api/auth`                             | "Mật khẩu cần ít nhất 12 ký tự."       | AC-03        |
| `INVALID_EMAIL_OR_PASSWORD`      | sai mật khẩu hoặc email không tồn tại         | 401                                             | "Email hoặc mật khẩu không đúng."      | AC-03, AC-04 |
| `TOO_MANY_ATTEMPTS` / hạn mức IP | quá ngưỡng sai theo tài khoản hoặc theo IP    | 429                                             | như trên, thử lại sau                  | AC-04        |
| `forbidden`                      | không phải thành viên hoặc thiếu quyền        | `ForbiddenError` ở dịch vụ; trang workspace 404 | "Bạn không có quyền…" / không tìm thấy | AC-05, AC-08 |
| `not_found`                      | ID không thuộc workspace hoặc không phải UUID | `NotFoundError`                                 | không tìm thấy                         | AC-05        |
| `conflict/last_owner`            | hạ/xoá owner cuối cùng                        | `ConflictError`                                 | "Workspace phải còn ít nhất một owner" | AC-07        |

## 7. Yêu cầu phi chức năng của tính năng

| Thuộc tính | Ngưỡng                                                                             | Nguồn       | Cách đo                                              |
| ---------- | ---------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------- |
| Bảo mật    | Argon2id ≥ tham số OWASP; mã phiên ≥ 128 bit; cookie `__Host-`, HttpOnly, SameSite | ASVS 5.0 L2 | `tests/auth`, `tests/auth-integration`               |
| Tin cậy    | 0 workspace không owner sau 30 lượt song song                                      | R-002       | `tests/auth/members.pg.test.ts` (Postgres thật ở CI) |

## 8. Hành vi AI

- Không dùng model.

## 9. Đo lường

- Sự kiện bảo mật đăng nhập (thành công/thất bại/bị chặn) ghi log theo `docs/security/security-events.md`; chưa có chỉ số sản phẩm riêng.

## 10. Câu hỏi mở

- [x] Spec cũ ghi "đăng ký thì có luôn một workspace do họ làm owner"; code tách hai bước (đăng ký → tạo workspace). — [không chặn] — Đã quyết: D-032 (phiên chính, 2026-11-24) — spec theo code: AC-01 và AC-02 tách riêng, luồng ở `PROJECT.md` §7.
- [x] Spec cũ ghi người ngoài luôn nhận "không tìm thấy"; dịch vụ trả Forbidden ở cấp workspace và NotFound theo ID. — [không chặn] — Đã quyết: D-032 (phiên chính, 2026-11-24) — spec theo code: hai tầng nhất quán như AC-05; trang vẫn trả 404 nên không lộ sự tồn tại.

## 11. DoR / DoD

- DoR: spec Approved · 0 câu hỏi chặn · phụ thuộc rõ · đủ nhỏ cho một PR · mỗi task có Gate.
- DoD: mọi AC có test chứa `F-001/AC-xx` và xanh · ca biên có test · cổng xanh · blueprint tick có bằng chứng.

## 12. Truy vết

| AC    | Test (tên hoặc chú thích chứa `F-001/AC-xx`)                             |
| ----- | ------------------------------------------------------------------------ |
| AC-01 | `tests/auth-integration/auth.test.ts`, `tests/auth/password.test.ts`     |
| AC-02 | `tests/workspaces/service.test.ts`, `tests/workspaces/atomicity.test.ts` |
| AC-03 | `tests/auth-integration/auth.test.ts`                                    |
| AC-04 | `tests/auth/throttle.test.ts`, `tests/auth-integration/auth.test.ts`     |
| AC-05 | `tests/auth/idor.test.ts`, `e2e/auth-flow.spec.ts`                       |
| AC-06 | `tests/auth/permissions.test.ts`                                         |
| AC-07 | `tests/auth/members.test.ts`, `tests/auth/members.pg.test.ts`            |
| AC-08 | `tests/auth/members.test.ts`                                             |
| AC-09 | `tests/auth-integration/auth.test.ts`, `tests/auth/members.test.ts`      |

- Task: đợt 0–1 (T-006, T-007), chuẩn hoá spec T-560 · Kiểm: `npx vitest run tests/config/specs.test.ts`.

## Thay đổi

| Phiên bản | Ngày       | Gì                                           | Vì sao                            | Duyệt |
| --------- | ---------- | -------------------------------------------- | --------------------------------- | ----- |
| 1         | 2026-11-22 | tạo (dạng rút gọn)                           | đợt 0–1                           | —     |
| 2         | 2026-11-24 | viết lại theo mẫu khung, AC có ID, theo code | WF-SDD-001..003, PM-SPEC-001..020 | D-032 |
