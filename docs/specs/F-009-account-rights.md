---
status: approved
approved_by: phiên chính (tự duyệt, ADR-0008, D-041)
approved_at: 2026-11-24
feature: F-009
requirements: [R-001, R-002]
---

# SPEC F-009 — Quyền của chủ tài khoản: xuất, xoá, đồng ý

Trạng thái: Approved for implementation

| Trường       | Giá trị                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| ID tính năng | F-009 (không có R riêng; áp R-001 cô lập dữ liệu, R-002 luôn còn owner)                                   |
| Phiên bản    | 1 — spec bù cho mã đã có (T-529, D-019, D-030, D-040); thay đổi: xem cuối file                            |
| Chủ spec     | phiên chính · Duyệt bởi phiên chính (D-041) ngày 2026-11-24                                               |
| Hồ sơ/quy mô | web-app / M                                                                                               |
| Quy ước ID   | `AC-xx` là ID scenario; test ghi `F-009/AC-xx` (xem `README.md`)                                          |
| Mã nguồn     | `src/retention/account.ts`, `src/workspaces/consent.ts`, `src/retention/erasure.ts`, `app/app/account/**` |

## 1. User story

Là chủ tài khoản, tôi muốn tự tải dữ liệu của mình, tự xoá tài khoản và cấp hoặc rút đồng ý gửi dữ liệu tới AI đám mây ở cùng một chỗ, để thực hiện quyền của chủ thể dữ liệu (Luật 91/2025/QH15, NĐ 356/2025) mà không phải nhờ ai.

## 2. Tiêu chí chấp nhận

### AC-01 — Tải dữ liệu của chính mình

- Given người dùng đã đăng nhập ở trang `/app/account`
- When bấm "Tải dữ liệu của tôi" (biểu mẫu `POST /app/account/export`)
- Then nhận tệp `du-lieu-cua-toi.json` (`Cache-Control: private, no-store`) của đúng người trong phiên: hồ sơ (tên, email, ngày tạo), workspace đang tham gia và vai trò, lịch sử đồng ý do mình cấp/rút, phiên đăng nhập (thời điểm, IP, thiết bị — không có mã phiên), tối đa 10.000 hành động gần nhất của mình trong sổ audit; không có mật khẩu, mã phiên hay dữ liệu của người khác; mỗi lần xuất ghi `data.exported` vào sổ audit của mọi workspace mình thuộc về

### AC-02 — Xuất khi không có phiên hợp lệ (ca lỗi)

- Given chưa đăng nhập, hoặc phiên trỏ tới người dùng không còn tồn tại
- When gọi `POST /app/account/export`
- Then không có phiên → 401 JSON `{"error":"unauthorized"}`, `Cache-Control: no-store`, không đọc dữ liệu; người dùng không tồn tại → `ForbiddenError`, không rò gì

### AC-03 — Xoá tài khoản

- Given người dùng nhập lại đúng mật khẩu và tích ô xác nhận
- When bấm "Xoá tài khoản"
- Then id lấy từ phiên (không từ form); workspace chỉ có mình bị xoá hẳn cùng mọi dữ liệu (cascade, kể cả tệp nội dung không còn nơi nào dùng; tệp dùng chung hash với workspace khác được giữ); workspace còn người khác chỉ gỡ mình khỏi danh sách (còn owner khác thì rời được); bản ghi đồng ý, phiên, đăng nhập, người dùng bị xoá; sổ audit giữ dòng `data.erased`/`member.removed` (chỉ còn mã người dùng); chuyển về `/login` và không đăng nhập lại được

### AC-04 — Sai mật khẩu hoặc thiếu xác nhận (ca lỗi)

- Given mật khẩu sai/rỗng, tài khoản không có mật khẩu đăng nhập (không có hàng `credential`), chưa tích ô xác nhận, hoặc chưa đăng nhập
- When bấm "Xoá tài khoản"
- Then không xoá gì; thiếu xác nhận → "Hãy tích ô xác nhận để xoá tài khoản." và không gọi dịch vụ; sai mật khẩu → "Mật khẩu không đúng.", ở lại trang; chưa đăng nhập → chuyển `/login`; lỗi lạ ném lại (không in ra giao diện)

### AC-05 — Giới hạn thử mật khẩu khi xoá (ca lỗi)

- Given kẻ giữ được phiên dò mật khẩu bằng bước xoá tài khoản
- When nhập sai nhiều lần
- Then bộ đếm riêng `reauth:delete-account:<userId>` (cùng cơ chế với đăng nhập, không đụng khoá đăng nhập theo email) khoá tạm: `TooManyAttemptsError`, dù sau đó nhập đúng cũng không xoá được cho tới khi hết khoá; mỗi lần sai/bị khoá ghi sự kiện bảo mật (`auth.login_failed`/`auth.login_locked`, `targetType: account_delete`) không chứa mật khẩu; nhập đúng xoá bộ đếm

### AC-06 — Chủ duy nhất của workspace còn người khác bị từ chối (ca lỗi)

- Given người dùng là owner duy nhất của một workspace còn thành viên khác
- When xoá tài khoản (đúng mật khẩu)
- Then `ConflictError` `owner_has_members` "Bạn là chủ duy nhất… hãy chuyển quyền chủ hoặc gỡ họ trước…", hiện ở trang; không xoá gì ở bất kỳ workspace nào (một giao dịch) — giữ R-002

### AC-07 — Cấp và rút đồng ý AI đám mây

- Given owner (quyền `workspace.settings`) ở trang workspace thấy văn bản đồng ý (`CONSENT_TEXT`, phiên bản `CONSENT_POLICY_VERSION`)
- When bấm "Đồng ý và bật AI đám mây", rồi "Rút đồng ý"
- Then bật ghi một dòng `consents` (chủ thể, mục đích `ai_cloud`, phiên bản văn bản, thời điểm, kênh `web`, băm sha256 của đúng văn bản đã hiển thị) cùng giao dịch với cờ và audit `workspace.ai_cloud_changed`; rút ghi một dòng MỚI có `withdrawn_at`, giữ nguyên `granted_at` và dòng cũ; bật hai lần chỉ một dòng cấp, rút khi chưa cấp hay rút hai lần không sinh dòng thừa; rút xong lượt gọi AI đám mây kế tiếp bị chặn ngay, cấp lại thì chạy; cờ bật mà thiếu bản ghi đồng ý cũng bị chặn; admin/member không đổi được cờ và không xem được lịch sử đồng ý; không có đường sửa/xoá bản ghi đồng ý ngoài xoá tài khoản

### AC-08 — Xuất dữ liệu theo dự án chỉ có ở tầng dịch vụ

- Given admin/owner (quyền `data.export`) và một dự án của workspace
- When mã server gọi `exportProject` (giao diện CHƯA có nút hay route gọi hàm này)
- Then trả tên, bí danh, liên kết và nội dung nguyên văn (đã kiểm hash) của nguồn, không kèm khoá hay mã nội bộ; ghi `data.exported`; member bị từ chối, dự án workspace khác là `NotFound`, vượt trần 10.000 mục bị từ chối, nội dung lệch hash là `IntegrityError`; trang tài khoản không hứa xuất theo dự án mà nói rõ "giao diện chưa có nút xuất theo dự án, hãy nhờ chủ workspace nếu cần bản sao"

## 3. Ca biên

| Nhóm                  | Ca cụ thể                                                                       | Hành vi mong đợi                                                            | AC                        |
| --------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------- |
| Rỗng/null             | mật khẩu rỗng; không có hàng `credential`; người dùng không tồn tại; dự án rỗng | từ chối; từ chối; Forbidden; xuất được dự án rỗng                           | AC-02, AC-04, AC-08       |
| Cực đại/độ dài        | > 10.000 dòng audit khi xuất tài khoản; > 10.000 mục khi xuất dự án             | cắt ở 10.000 mới nhất; từ chối xuất dự án                                   | AC-01, AC-08              |
| Trùng lặp/idempotency | bật đồng ý hai lần; rút hai lần; tệp nội dung dùng chung hash                   | một dòng cấp; không dòng thừa; giữ tệp còn nơi dùng                         | AC-03, AC-07              |
| Song song             | dò mật khẩu liên tiếp; xoá tài khoản khi còn người khác trong workspace         | giữ chỗ lượt thử trước khi kiểm (nguyên tử); kiểm owner trong một giao dịch | AC-05, AC-06              |
| Mất mạng giữa chừng   | lỗi giữa các bước xoá phần CSDL                                                 | một giao dịch: hoặc xoá hết hoặc không xoá gì; tệp dọn sau giao dịch        | AC-03, AC-06              |
| Thời gian/múi giờ     | rút đồng ý trong cùng mili giây với lần cấp; đồng hồ lệch                       | dòng mới luôn đứng sau dòng trước (`created_at` + 1 ms); xuất ISO 8601 UTC  | AC-01, AC-07              |
| Quyền                 | id người khác trong form; không đăng nhập; member xuất dự án; admin đổi đồng ý  | bỏ qua id form; 401 / `/login`; Forbidden                                   | AC-02–AC-04, AC-07, AC-08 |
| Tiền/đơn vị           | —                                                                               | không áp dụng — tính năng không xử lý tiền hay đơn vị đo                    | —                         |

## 4. Dữ liệu

| Thực thể         | Trường                                                                                                    | Kiểu             | Ràng buộc                                                 | Ai đọc/ghi                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------- | -------------------------------------------- |
| `consents`       | `subject_id`, `purpose_id`, `policy_version`, `granted_at`, `withdrawn_at`, `channel`, `ui_snapshot_hash` | text/timestamptz | chỉ ghi thêm ở dịch vụ; xoá cùng workspace hoặc tài khoản | owner ghi; owner đọc lịch sử; chủ thể xuất   |
| `audit_events`   | `actor_id`, `action`, `target_type`, `outcome`, `source_ip`                                               | text/timestamptz | append-only (trigger); giữ ≥ 12 tháng                     | ghi khi xuất/xoá; chủ thể xuất dòng của mình |
| `login_throttle` | `key_hash` (HMAC của khoá `reauth:delete-account:<userId>`)                                               | text             | dọn sau 24 giờ                                            | dịch vụ xoá tài khoản                        |

- Kiểm kê và căn cứ giữ lại: `docs/compliance/data-inventory.csv`, PROJECT.md §5 "Quyền chủ thể".

## 5. Giao diện / API

- `/app/account`: tên, email; khối "Xuất dữ liệu của bạn" (biểu mẫu `POST /app/account/export`); khối "Xoá tài khoản" (nhập lại mật khẩu, ô "Tôi hiểu việc xoá…", Server Action `deleteAccountAction`).
- `/app/<workspace>` (owner): văn bản đồng ý (`data-consent-text`), trạng thái (`data-consent-state`), một nút bật/rút, danh sách "Lịch sử đồng ý"; Server Action `setAiCloudAction`.
- Chưa có giao diện: xuất theo dự án (`exportProject`), xoá hội thoại/tài liệu/dự án theo yêu cầu (`eraseConversation`, `eraseEvidenceItem`, `eraseProject`), hàng chờ yêu cầu của người nhắn tin không có tài khoản (CMP-VN-007).

## 6. Lỗi

| Mã lỗi                    | Khi nào                                             | HTTP/exit code                     | Thông điệp cho người dùng                    | AC           |
| ------------------------- | --------------------------------------------------- | ---------------------------------- | -------------------------------------------- | ------------ |
| `unauthorized`            | xuất khi chưa đăng nhập                             | 401                                | — (tải tệp)                                  | AC-02        |
| `forbidden`               | sai mật khẩu; người dùng không tồn tại; thiếu quyền | `ForbiddenError`                   | "Mật khẩu không đúng." / không có quyền      | AC-02, AC-04 |
| (form)                    | chưa tích ô xác nhận                                | trạng thái form                    | "Hãy tích ô xác nhận để xoá tài khoản."      | AC-04        |
| `too_many_attempts`       | dò mật khẩu                                         | `TooManyAttemptsError`             | "Thử quá nhiều lần, hãy thử lại sau ít phút" | AC-05        |
| `owner_has_members`       | chủ duy nhất của workspace còn người khác           | `ConflictError`                    | hướng dẫn chuyển quyền chủ trước             | AC-06        |
| `not_found` / `integrity` | xuất dự án lạ / nội dung lệch hash                  | `NotFoundError` / `IntegrityError` | không tìm thấy                               | AC-08        |

## 7. Yêu cầu phi chức năng của tính năng

| Thuộc tính | Ngưỡng                                                               | Nguồn                                       | Cách đo                                                |
| ---------- | -------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------ |
| Pháp lý    | yêu cầu tự phục vụ có hiệu lực tức thì (nhanh hơn mốc 10/15/20 ngày) | NĐ 356/2025 Đ.5 (chưa xác minh với bản gốc) | `tests/retention/rights.test.ts`, `e2e/rights.spec.ts` |
| Bảo mật    | 0 mật khẩu/mã phiên trong tệp xuất và log; dò mật khẩu bị khoá       | AUD-CODE-008, ASVS 5.0 L2                   | `tests/retention/rights.test.ts`                       |

## 8. Hành vi AI

- Không gọi model. Tính năng chỉ ghi/rút đồng ý mà cổng AI (F-008) đọc trước mỗi lượt gọi đám mây.

## 9. Đo lường

- Sổ audit (`data.exported`, `data.erased`, `member.removed`, `workspace.ai_cloud_changed`) và sự kiện bảo mật khi dò mật khẩu; chưa có chỉ số sản phẩm riêng.

## 10. Câu hỏi mở

- [x] Bản ghi đồng ý, quyền chủ thể và kiểm kê làm theo hình nào? — [không chặn] — Đã quyết: D-030 (phiên chính, 2026-11-24) — bảng `consents` chỉ ghi thêm, kiểm kê duy nhất ở `docs/compliance/data-inventory.csv`.
- [x] Trang tài khoản từng hứa xuất theo dự án mà không có giao diện. — [không chặn] — Đã quyết: D-040 (phiên chính, 2026-11-24) — sửa câu chữ khớp thực tế, test chặn hứa suông; `exportProject` chỉ là dịch vụ (AC-08).
- [x] Spec viết theo mã đã có? — [không chặn] — Đã quyết: D-041 (phiên chính, 2026-11-24) — theo hành vi thật, kể cả xuất là `POST` (có ghi audit) chứ không phải `GET`.

## 11. DoR / DoD

- DoR: spec Approved · 0 câu hỏi chặn · phụ thuộc rõ (F-001 đăng nhập, F-008 cổng AI) · đủ nhỏ cho một PR · mỗi task có Gate.
- DoD: mọi AC có test chứa `F-009/AC-xx` và xanh · ca biên có test · cổng xanh · blueprint tick có bằng chứng.

## 12. Truy vết

| AC    | Test (tên chứa `F-009/AC-xx`)                                                                    |
| ----- | ------------------------------------------------------------------------------------------------ |
| AC-01 | `tests/retention/rights.test.ts`, `tests/retention/account-action.test.ts`, `e2e/rights.spec.ts` |
| AC-02 | `tests/retention/rights.test.ts`, `tests/retention/account-action.test.ts`                       |
| AC-03 | `tests/retention/rights.test.ts`, `tests/retention/account-action.test.ts`, `e2e/rights.spec.ts` |
| AC-04 | `tests/retention/rights.test.ts`, `tests/retention/account-action.test.ts`, `e2e/rights.spec.ts` |
| AC-05 | `tests/retention/rights.test.ts`, `tests/retention/account-action.test.ts`                       |
| AC-06 | `tests/retention/rights.test.ts`, `tests/retention/account-action.test.ts`                       |
| AC-07 | `tests/retention/rights.test.ts`, `tests/ai/gateway.test.ts`, `e2e/rights.spec.ts`               |
| AC-08 | `tests/retention/erasure.test.ts`, `tests/retention/rights.test.ts`                              |

- Task: T-529 (D-019, D-030), AUD-DATA-008 (D-040), spec bù theo D-041 · Kiểm: `npx vitest run tests/config/specs.test.ts`.

## Thay đổi

| Phiên bản | Ngày       | Gì                        | Vì sao                                  | Duyệt |
| --------- | ---------- | ------------------------- | --------------------------------------- | ----- |
| 1         | 2026-11-24 | tạo spec bù theo mã đã có | AUD-HAR-013: tính năng có mã, chưa spec | D-041 |
