---
status: approved
approved_by: phiên chính (tự duyệt, ADR-0008, D-041)
approved_at: 2026-11-24
feature: F-006
requirements: [R-001]
---

# SPEC F-006 — Hội thoại, nháp trả lời và yêu cầu gửi

Trạng thái: Approved for implementation

| Trường       | Giá trị                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------- |
| ID tính năng | F-006 (không có R riêng; áp R-001 cô lập workspace)                                      |
| Phiên bản    | 1 — spec bù cho mã đã có (đợt xw-4, D-015, D-016); thay đổi: xem cuối file               |
| Chủ spec     | phiên chính · Duyệt bởi phiên chính (D-041) ngày 2026-11-24                              |
| Hồ sơ/quy mô | web-app / M                                                                              |
| Quy ước ID   | `AC-xx` là ID scenario; test ghi `F-006/AC-xx` (xem `README.md`)                         |
| Mã nguồn     | `src/conversations/threads.ts`, `src/actions/`, `app/app/[workspaceId]/conversations/**` |

## 1. User story

Là thành viên workspace, tôi muốn đọc trọn một cuộc hội thoại với khách, soạn nháp trả lời có lịch sử phiên bản và yêu cầu gửi nháp đã duyệt, để trả lời khách đúng một lần, không gửi trùng và luôn biết tin đã đi hay chưa.

## 2. Tiêu chí chấp nhận

### AC-01 — Xem danh sách và luồng hội thoại

- Given workspace có hội thoại đã đồng bộ (F-003)
- When thành viên mở trang Hội thoại rồi mở một hội thoại
- Then danh sách xếp mới hoạt động nhất trước (chưa có tin xếp cuối), phân trang con trỏ `<ms>.<uuid>` không sót không lặp, `limit` kẹp 1..100 (mặc định 30); luồng tin xếp cũ → mới, tối đa 200 tin mới nhất (mặc định 100) và báo `truncated`; kèm nháp (nội dung phiên bản hiện tại) và lịch sử hành động gửi, mới nhất trước

### AC-02 — Soạn nháp có phiên bản

- Given một hội thoại thuộc workspace
- When thành viên (quyền `inbox.reply`) lưu nháp lần đầu rồi sửa
- Then nháp mới ở phiên bản 1, nguồn `human`, trạng thái `open`, nội dung chuẩn hoá NFC và cắt khoảng trắng hai đầu; mỗi lần sửa tạo phiên bản `n + 1`, các phiên bản cũ giữ nguyên; xoá hội thoại xoá luôn nháp và phiên bản

### AC-03 — Hai người sửa cùng phiên bản nền (ca lỗi)

- Given nháp đang ở phiên bản `n`, hoặc nháp đã `discarded`/`sent`
- When hai người cùng sửa dựa trên phiên bản `n`, hoặc sửa dựa trên phiên bản cũ, hoặc sửa/bỏ nháp đã đóng
- Then chỉ một người thắng; người kia nhận `ConflictError` `version_conflict` nêu phiên bản hiện tại, không mất bản nào; nháp đã đóng trả `draft_closed`

### AC-04 — Nội dung nháp không hợp lệ (ca lỗi)

- Given nội dung rỗng, chỉ khoảng trắng hoặc dài hơn 4000 ký tự
- When lưu nháp
- Then `ValidationError` "Nội dung phải dài 1-4000 ký tự", không có dòng nào được ghi; đúng 4000 ký tự được nhận; CHECK của CSDL từ chối phiên bản trùng, nguồn lạ, nội dung rỗng

### AC-05 — Yêu cầu gửi lũy đẳng theo khoá

- Given nháp `open`; trang dựng sẵn khoá lũy đẳng (UUID) trong form
- When bấm Yêu cầu gửi một lần, bấm đúp, hoặc hai yêu cầu cùng khoá chạy song song
- Then đúng một dòng sổ `action_ledger` trạng thái `queued` trỏ phiên bản nháp hiện tại, có băm nội dung và số byte, người nhận suy ra từ hội thoại, KHÔNG lưu nội dung; cùng khoá trả lại cùng hành động (`created: false`, kể cả sau khi đã gửi xong); cùng khoá cho nháp khác hoặc khoá khác cho nháp đang có hành động còn hiệu lực là `idempotency_conflict`; khoá rỗng hoặc dài hơn 128 ký tự bị từ chối; sau `blocked`/`failed` thì yêu cầu lại bằng khoá mới được

### AC-06 — Gửi thật tắt mặc định; chính sách chặn có dấu vết (ca lỗi)

- Given cờ hệ thống `OUTBOUND_LIVE` (mặc định `false`) hoặc cờ `outbound_enabled` của workspace (mặc định tắt, chỉ owner đổi qua dịch vụ) đang tắt, hội thoại chưa có tin đến, quá cửa sổ nhắn tin (Facebook/Instagram/WhatsApp và nền tảng chưa khai 24 giờ, Zalo 7 ngày kể từ tin đến cuối), nội dung quá giới hạn nền tảng (Facebook 2000 ký tự, Instagram 1000 byte UTF-8) hoặc vượt hạn mức giờ (mặc định 10/giờ, 0..1000)
- When yêu cầu gửi
- Then vẫn ghi một dòng `blocked` kèm lý do (`outbound_disabled`, `policy_disabled`, `no_incoming_message`, `window_closed`, `text_too_long`, `rate_limited`, kiểm theo đúng thứ tự đó), không xếp hàng, không gọi nhà cung cấp; giao diện hiện lời giải thích và ghi "Bị chặn, chưa gửi" ở Lịch sử gửi; trang báo trước "Gửi tin đang tắt" khi workspace chưa bật

### AC-07 — Việc nền gửi đúng một lần

- Given hành động `queued`, `OUTBOUND_LIVE=true` và chính sách vẫn cho phép lúc gửi
- When job `actions.dispatch` (mỗi phút, lô 20, cũ nhất trước) nhận việc, kể cả hai tiến trình nhận cùng lúc hoặc gọi lại sau khi đã xong
- Then nhận việc bằng cập nhật có điều kiện nên chỉ một tiến trình thắng; nhà cung cấp bị gọi đúng một lần với đúng tài khoản, hội thoại và nội dung phiên bản đã duyệt; thành công → `confirmed` kèm id tin, nháp thành `sent`; lần gọi lại là `skipped`; cờ hệ thống tắt giữa chừng → `deferred`, hàng đợi giữ nguyên; trước khi gửi mà workspace tắt gửi hoặc cửa sổ đã đóng → `blocked`; nội dung phiên bản bị đổi sau khi duyệt → `failed` `draft_changed`

### AC-08 — Kết quả không chắc thành send_unknown, không gửi lại (ca lỗi)

- Given nhà cung cấp hết giờ, mất kết nối, trả 5xx, phản hồi sai hình dạng, lỗi lạ, hoặc tiến trình chết khi đang `dispatching`/`cancel_requested`
- When việc gửi kết thúc, hoặc job `actions.recover-stuck` (mỗi 5 phút) thấy dòng kẹt quá 10 phút
- Then hành động thành `send_unknown` với mã lỗi an toàn (`http.502`, `client.timeout`, `interrupted`, `internal`…), không lộ nội dung lỗi; KHÔNG BAO GIỜ tự gửi lại hay đưa về `queued`; nháp vẫn bị khoá (yêu cầu mới bị `idempotency_conflict`) cho tới khi đối soát hoặc người quyết; từ chối chắc chắn của nhà cung cấp là `failed` (hết cửa sổ là `blocked` `window_closed`); lỗi trước khi gọi nhà cung cấp là `failed` `precheck_failed`

### AC-09 — Đối soát và người quyết send_unknown

- Given hành động `send_unknown`
- When job `actions.reconcile` (mỗi 2 phút, chỉ hành động 2 phút..24 giờ tuổi) đọc lại tin gửi đi của hội thoại, hoặc admin/owner bấm "Đã gửi"/"Chưa gửi"
- Then thấy tin ĐI cùng băm nội dung, không sớm hơn lúc gửi trừ 60 giây → `confirmed`, nháp `sent`; không thấy → giữ `send_unknown` kèm `not_found`; đọc lỗi → giữ kèm `error`; đối soát không bao giờ gọi gửi; người quyết `sent` → `confirmed`, `not_sent` → `failed` `confirmed_not_sent` và mở đường cho yêu cầu MỚI; member không quyết được; quyết lại hoặc quyết hành động không ở `send_unknown` là `action_not_unknown`

### AC-10 — Huỷ yêu cầu và bỏ nháp

- Given hành động `queued` hoặc `dispatching`, hoặc nháp `open` có/không có hành động
- When người tạo hoặc admin/owner bấm Huỷ, hoặc thành viên bấm Bỏ nháp
- Then `queued` → `cancelled` (không bao giờ gửi); `dispatching` → `cancel_requested` (không rút lại được tin đang đi, kết quả thật vẫn được ghi); hành động đã xong, đang `send_unknown`, đã huỷ hoặc bị chặn thì `action_not_cancellable`; người khác (không phải người tạo, không phải admin/owner) bị từ chối; bỏ nháp huỷ luôn hành động `queued` của nó trong cùng giao dịch, nhưng nháp có hành động `dispatching`/`cancel_requested`/`send_unknown` thì bị từ chối `draft_send_pending` và không đổi gì

### AC-11 — Người ngoài và ID lạ bị chặn (ca lỗi)

- Given người không thuộc workspace, hoặc ID hội thoại/nháp/hành động của workspace khác hay không phải UUID
- When xem hội thoại, soạn nháp, yêu cầu gửi, huỷ hoặc xem hành động
- Then người ngoài bị `ForbiddenError`; ID không thuộc workspace là `NotFoundError` (trang trả 404), không để lại dòng nào và không gọi nhà cung cấp

## 3. Ca biên

| Nhóm                  | Ca cụ thể                                                                                    | Hành vi mong đợi                                                              | AC                  |
| --------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------- |
| Rỗng/null             | nháp rỗng/khoảng trắng; hội thoại không có tin; `last_message_at` null; Zalo trả id tin rỗng | từ chối; mảng rỗng; xếp cuối; `confirmed` với danh sách id rỗng               | AC-01, AC-04, AC-07 |
| Cực đại/độ dài        | nháp 4001 ký tự; khoá lũy đẳng > 128; Facebook 2001 ký tự; `limit` 9999                      | từ chối; từ chối; `blocked` `text_too_long`; kẹp 100/200                      | AC-01, AC-04–AC-06  |
| Trùng lặp/idempotency | bấm đúp Yêu cầu gửi; gọi dispatch lần hai; đối soát lặp                                      | một hành động; `skipped`; không bao giờ gửi lại                               | AC-05, AC-07, AC-09 |
| Song song             | hai người sửa cùng phiên bản; hai dispatch cùng hành động; bỏ nháp đua với gửi               | một thắng, người kia xung đột; nhà cung cấp gọi một lần; không vừa bỏ vừa gửi | AC-03, AC-07, AC-10 |
| Mất mạng giữa chừng   | hết giờ/mất kết nối khi gửi; tiến trình chết khi `dispatching`; đọc lại lỗi khi đối soát     | `send_unknown`, không gửi lại; gỡ sau 10 phút; giữ `send_unknown` kèm `error` | AC-08, AC-09        |
| Thời gian/múi giờ     | đúng biên cửa sổ 24 giờ/7 ngày; tin đến "ở tương lai"; lệch đồng hồ ±60 giây khi đối soát    | đúng biên còn mở; coi như vừa đến; sớm 61 giây không nhận; lưu và so theo UTC | AC-06, AC-09        |
| Quyền                 | người ngoài; ID workspace khác; member quyết `send_unknown`; người khác huỷ yêu cầu          | Forbidden / NotFound / từ chối                                                | AC-09–AC-11         |
| Tiền/đơn vị           | giới hạn độ dài theo ký tự (Facebook) và theo byte UTF-8 (Instagram)                         | đếm đúng đơn vị của từng nền tảng; tính năng không xử lý tiền                 | AC-06               |

## 4. Dữ liệu

| Thực thể         | Trường                                                                                                                              | Kiểu               | Ràng buộc                                                                                        | Ai đọc/ghi                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------- |
| `drafts`         | `conversation_id`, `status` (`open`/`discarded`/`sent`), `current_version`, `created_by`                                            | uuid/text/int      | cascade theo hội thoại                                                                           | thành viên đọc; `inbox.reply` ghi   |
| `draft_versions` | `version`, `text`, `source` (`human`/`ai`), `created_by`                                                                            | int/text           | UNIQUE (nháp, phiên bản); CHECK nguồn, nội dung không rỗng                                       | như trên                            |
| `action_ledger`  | `state`, `blocked_reason`, `error_code`, `draft_version`, `recipient_ref`, `text_hash`, `text_bytes`, `idempotency_key`, `attempts` | text/int/timestamp | UNIQUE (workspace, khoá); một hành động còn hiệu lực mỗi nháp; `attempts` ≤ 1; không có nội dung | `inbox.reply` tạo; job gửi/đối soát |
| `workspaces`     | `outbound_enabled` (mặc định `false`), `outbound_max_per_hour` (mặc định 10, 0..1000)                                               | boolean/int        | CHECK 0..1000                                                                                    | owner ghi qua dịch vụ               |

- Xoá hội thoại/nháp giữ sổ hành động (SET NULL) làm dấu vết; xoá workspace xoá sổ.

## 5. Giao diện / API

- Trang `/app/<workspace>/conversations` (danh sách) và `/app/<workspace>/conversations/<id>` (luồng tin, biên soạn nháp, Yêu cầu gửi, Bỏ nháp, Lịch sử gửi, Huỷ, Đã gửi/Chưa gửi cho admin/owner). Server Action: `saveDraftAction`, `discardDraftAction`, `requestSendAction`, `cancelActionAction`, `resolveUnknownAction`.
- Nội dung tin là văn bản thuần (React escape), không render HTML.
- Bật/tắt gửi của workspace (`setOutbound`) và hạn mức giờ hiện chỉ có ở tầng dịch vụ; giao diện chưa có nút bật — trang chỉ báo "Gửi tin đang tắt".

## 6. Lỗi

| Mã lỗi                                          | Khi nào                                                       | HTTP/exit code                     | Thông điệp cho người dùng                 | AC           |
| ----------------------------------------------- | ------------------------------------------------------------- | ---------------------------------- | ----------------------------------------- | ------------ |
| `version_conflict` / `draft_closed`             | sửa dựa phiên bản cũ / nháp đã đóng                           | `ConflictError`                    | nêu phiên bản hiện tại / nháp đã đóng     | AC-03        |
| `validation`                                    | nội dung 0 hoặc > 4000 ký tự; khoá lũy đẳng sai độ dài        | `ValidationError`                  | thông điệp cụ thể                         | AC-04, AC-05 |
| `idempotency_conflict`                          | khoá dùng cho nháp khác; nháp đã có hành động còn hiệu lực    | `ConflictError`                    | yêu cầu khác đang xử lý                   | AC-05, AC-08 |
| `blocked` + lý do                               | chính sách gửi từ chối                                        | dòng sổ `blocked`                  | nhãn theo lý do (`src/actions/labels.ts`) | AC-06        |
| `send_unknown`                                  | kết quả gửi không chắc                                        | dòng sổ `send_unknown`             | "không chắc tin đã đi… sẽ không tự gửi"   | AC-08        |
| `action_not_cancellable` / `action_not_unknown` | huỷ khi không còn huỷ được / quyết khi không ở `send_unknown` | `ConflictError`                    | thông điệp cụ thể                         | AC-09, AC-10 |
| `draft_send_pending`                            | bỏ nháp đang gửi hoặc chưa rõ kết quả                         | `ConflictError`                    | nháp đang được gửi hoặc chưa rõ           | AC-10        |
| `forbidden` / `not_found`                       | người ngoài / ID lạ                                           | `ForbiddenError` / `NotFoundError` | không có quyền / không tìm thấy           | AC-11        |

## 7. Yêu cầu phi chức năng của tính năng

| Thuộc tính | Ngưỡng                                                                             | Nguồn         | Cách đo                                                        |
| ---------- | ---------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------- |
| Tin cậy    | 0 tin gửi trùng khi bấm đúp, chạy song song hay gỡ kẹt; hành động kẹt gỡ ≤ 10 phút | PROJECT.md §3 | `tests/actions/`, `tests/actions/ledger-stuck.test.ts`         |
| Bảo mật    | không có đường gửi khi một trong hai cờ tắt; sổ không lưu nội dung tin             | D-015         | `tests/actions/ledger.test.ts`, `tests/actions/policy.test.ts` |

## 8. Hành vi AI

- Không gọi model ở tính năng này. Trường `source: "ai"` của phiên bản nháp chỉ do mã server đặt; hiện không có đường nào tạo nháp bằng AI (`tests/ai/agent-boundary.test.ts`), và mọi nháp đều phải người bấm Yêu cầu gửi.

## 9. Đo lường

- Log kết quả job (`sent`, `blocked`, `failed`, `send_unknown`, `skipped`, `deferred`, `cancelled`; đối soát `confirmed`/`not_found`/`error`); chưa có chỉ số sản phẩm riêng.

## 10. Câu hỏi mở

- [x] Gửi thật bật lúc nào? — [không chặn] — Đã quyết: D-015 (phiên chính, 2026-11-23) — hai khoá độc lập `OUTBOUND_LIVE` và `outbound_enabled`, mặc định tắt; bật thật là quyết định của chủ dự án (AC-06).
- [x] Spec viết theo mã đã có hay theo kế hoạch? — [không chặn] — Đã quyết: D-041 (phiên chính, 2026-11-24) — theo hành vi thật; giao diện bật gửi cho owner chưa có nên spec không hứa (mục 5).

## 11. DoR / DoD

- DoR: spec Approved · 0 câu hỏi chặn · phụ thuộc rõ (F-003 cho hội thoại) · đủ nhỏ cho một PR · mỗi task có Gate.
- DoD: mọi AC có test chứa `F-006/AC-xx` và xanh · ca biên có test · cổng xanh · blueprint tick có bằng chứng.

## 12. Truy vết

| AC    | Test (tên chứa `F-006/AC-xx`)                                                                                           |
| ----- | ----------------------------------------------------------------------------------------------------------------------- |
| AC-01 | `tests/conversations/threads.test.ts`                                                                                   |
| AC-02 | `tests/actions/drafts.test.ts`                                                                                          |
| AC-03 | `tests/actions/drafts.test.ts`                                                                                          |
| AC-04 | `tests/actions/drafts.test.ts`                                                                                          |
| AC-05 | `tests/actions/ledger.test.ts`                                                                                          |
| AC-06 | `tests/actions/ledger.test.ts`, `tests/actions/policy.test.ts`, `tests/config/env.test.ts`, `e2e/conversations.spec.ts` |
| AC-07 | `tests/actions/ledger.test.ts`                                                                                          |
| AC-08 | `tests/actions/ledger.test.ts`, `tests/actions/ledger-stuck.test.ts`                                                    |
| AC-09 | `tests/actions/unknown.test.ts`                                                                                         |
| AC-10 | `tests/actions/unknown.test.ts`, `tests/actions/discard-after-queue.test.ts`                                            |
| AC-11 | `tests/actions/drafts.test.ts`, `tests/actions/ledger.test.ts`, `tests/conversations/threads.test.ts`                   |

- Task: đợt xw-4 và giao diện hội thoại (D-015, D-016), spec bù theo D-041 · Kiểm: `npx vitest run tests/config/specs.test.ts`.

## Thay đổi

| Phiên bản | Ngày       | Gì                        | Vì sao                                  | Duyệt |
| --------- | ---------- | ------------------------- | --------------------------------------- | ----- |
| 1         | 2026-11-24 | tạo spec bù theo mã đã có | AUD-HAR-013: tính năng có mã, chưa spec | D-041 |
