---
status: approved
approved_by: phiên chính (tự duyệt, ADR-0008, D-041)
approved_at: 2026-11-24
feature: F-008
requirements: [R-001]
---

# SPEC F-008 — Hỏi đáp AI có trích dẫn

Trạng thái: Approved for implementation

| Trường       | Giá trị                                                                       |
| ------------ | ----------------------------------------------------------------------------- |
| ID tính năng | F-008 (không có R riêng; áp R-001 cô lập workspace)                           |
| Phiên bản    | 1 — spec bù cho mã đã có (đợt xw-3, D-014, ADR-0005); thay đổi: xem cuối file |
| Chủ spec     | phiên chính · Duyệt bởi phiên chính (D-041) ngày 2026-11-24                   |
| Hồ sơ/quy mô | web-app / M                                                                   |
| Quy ước ID   | `AC-xx` là ID scenario; test ghi `F-008/AC-xx` (xem `README.md`)              |
| Mã nguồn     | `src/ai/**`, `src/search/service.ts`, `app/app/[workspaceId]/search/**`       |

## 1. User story

Là thành viên workspace, tôi muốn đặt câu hỏi bằng tiếng Việt và nhận câu trả lời ngắn chỉ dựa trên kho bằng chứng của workspace, mỗi ý có trích dẫn nguồn, để tra cứu nhanh mà vẫn kiểm được; dữ liệu khách chỉ rời máy chủ khi chủ workspace đã đồng ý.

## 2. Tiêu chí chấp nhận

### AC-01 — Trả lời kèm trích dẫn đúng nguồn

- Given AI được cấu hình, kho có bằng chứng liên quan
- When thành viên (quyền `evidence.read`) hỏi ở trang Tìm kiếm
- Then dịch vụ tìm "một trong các từ" (bỏ từ dừng) lấy tối đa `topK` nguồn (mặc định 5, kẹp 1..8; mỗi nguồn ≤ 1500 ký tự, tổng ≤ 12.000), đóng khung từng nguồn bằng ranh giới ngẫu nhiên mỗi lượt, gửi mô hình; câu trả lời hợp lệ trả `answered: true`, `generatedBy: "ai"`, danh sách trích dẫn (số nguồn, id bằng chứng, nguồn, id ngoài, đoạn trích) đã gộp trùng và `disclosureId`; giao diện gắn nhãn "Do AI tạo"

### AC-02 — Không có nguồn thì không gọi mô hình

- Given truy xuất không ra bằng chứng nào, hoặc mọi nguồn tìm được đều không đọc được (lệch hash)
- When hỏi
- Then trả `answered: false`, `reason: "no_evidence"`, không gọi mô hình, không ghi nhật ký `ai_disclosures`

### AC-03 — Đầu ra sai bị loại, không hiển thị (ca lỗi)

- Given mô hình trả JSON hỏng/sai kiểu/thiếu trường/thừa khoá, câu trả lời rỗng hoặc > 4000 ký tự, trích dẫn bịa (ngoài 1..số nguồn, 0, âm, lẻ) hoặc rỗng, có thẻ HTML/script, ảnh markdown, ký tự điều khiển, URL không có trong nguồn, bị cắt do hết `max_tokens`, hoặc từ chối/bị lọc
- When dịch vụ kiểm đầu ra bằng mã
- Then `invalid_output` (hoặc `refused` khi mô hình từ chối, `insufficient` khi `answer: null`); không trả câu trả lời; khoá thừa bị bỏ; JSON trong hàng rào ``` vẫn nhận

### AC-04 — Guard đầu vào tất định chạy trước truy xuất (ca lỗi)

- Given câu hỏi chứa mẫu đổi luật/moi lời nhắc ("bỏ qua hướng dẫn trước đó", "ignore previous instructions", "developer mode"…), hành vi bị cấm (chấm điểm xã hội, nhận diện cảm xúc, deepfake, thao túng, giả làm người), ký tự điều khiển; hoặc thuộc nhóm rủi ro cao (y tế, pháp lý, tài chính cá nhân, trẻ em, tự hại)
- When hỏi
- Then trả `blocked_input` hoặc `human_required`, không truy xuất, không gọi mô hình, không ghi nhật ký gửi; không có tham số nào để tắt guard; câu hỏi nghiệp vụ thường ("bỏ qua hướng dẫn bảo quản hoa…", "từ từ rồi giao") không bị chặn nhầm

### AC-05 — AI tắt mặc định (ca lỗi)

- Given `AI_BASE_URL` trống (mặc định của `.env` và compose)
- When mở trang Tìm kiếm hoặc gọi hỏi đáp
- Then trang không có form hỏi mà ghi "AI chưa được bật…; tìm kiếm ở trên vẫn dùng bình thường"; dịch vụ ném `AiDisabledError` trước khi truy xuất, cổng AI không gọi gì và không ghi nhật ký; đặt `AI_BASE_URL` mà thiếu `AI_MODEL` thì máy chủ không khởi động

### AC-06 — Điểm cuối đám mây cần cờ và đồng ý còn hiệu lực

- Given điểm cuối KHÔNG cục bộ (không phải localhost, loopback, mạng riêng 10/8, 172.16/12, 192.168/16, fc00::/7, link-local, hay tên một nhãn như `ollama`)
- When workspace chưa bật `ai_cloud_enabled`, hoặc cờ bật mà không có bản ghi đồng ý đang hiệu lực (F-009), rồi hỏi
- Then cổng ghi một dòng `blocked` (0 byte), ghi sự kiện bảo mật `ai.blocked`, ném `AiNotAllowedError`, không gửi gì; owner bật thì chạy, tắt lại thì chặn ngay; điểm cuối cục bộ chạy không cần cờ

### AC-07 — Nhật ký ghi trước khi gửi, không có nội dung

- Given một lượt gọi được phép
- When cổng gửi lời nhắc
- Then dòng `ai_disclosures` (`sent`: điểm cuối, mô hình, cục bộ hay không, số mục, số byte UTF-8 của bản thực gửi) được ghi TRƯỚC khi gửi — ghi lỗi thì không gửi; xong thì `ok`, mô hình lỗi thì `error` kèm mã an toàn (`model.timeout`, `model.http.502`…) và lỗi được ném lại; log `gen_ai.*` chỉ có số token, mô hình, lý do dừng, số mục đã che — không có lời nhắc hay câu trả lời

### AC-08 — Ngân sách mỗi workspace trong 24 giờ trượt (ca lỗi)

- Given ngân sách mặc định 500 lượt, 20.000.000 byte, 300 lượt cho một mục đích mỗi 24 giờ
- When mức dùng (tỉ lệ lớn nhất của ba trần) chạm 80%, rồi 100%
- Then 80% ghi cảnh báo; 100% ghi dòng `blocked`, sự kiện `ai.budget_exceeded`, ném `AiBudgetError`, không gọi mô hình; workspace khác và mục đích khác không bị ảnh hưởng; lượt `blocked` không tính vào ngân sách

### AC-09 — Che PII trước khi gửi ra đám mây

- Given nguồn có email, CCCD 12 số, số điện thoại Việt Nam, địa chỉ có số nhà kèm đơn vị hành chính
- When gửi tới điểm cuối không cục bộ
- Then các mẫu đó thành `[EMAIL]`, `[CCCD]`, `[SĐT]`, `[ĐỊA CHỈ]` trong lời nhắc; số byte nhật ký là của bản đã che; số tiền, ngày, mã đơn, số lượng không bị che; điểm cuối cục bộ giữ nguyên văn; che là cấu hình dựng cổng (mặc định bật), không phải tham số của người gọi

### AC-10 — Quyền và trần đầu vào (ca lỗi)

- Given người ngoài workspace, câu hỏi rỗng hoặc > 1000 ký tự, lời nhắc > 200.000 byte, mục đích hay số mục không hợp lệ
- When hỏi hoặc gọi cổng
- Then người ngoài `ForbiddenError` trước khi gửi; câu hỏi sai độ dài `ValidationError`; vượt trần byte bị từ chối trước khi ghi nhật ký và gửi (đúng trần được nhận); lọc theo dự án chỉ đưa nguồn của dự án đó vào lời nhắc

### AC-11 — Minh bạch: người dùng biết đang dùng AI

- Given trang Tìm kiếm, AI bật hay tắt
- When người dùng mở trang và nhận câu trả lời
- Then thông báo chữ nhìn thấy trước khi hỏi: do AI trả lời, không phải người, có thể sai, chỉ đọc kho và không tự gửi/sửa gì; câu trả lời và đoạn trích là văn bản thuần (escape), không sinh thẻ, liên kết hay nút; không có `dangerouslySetInnerHTML` hay bộ render markdown cho đầu ra AI

## 3. Ca biên

| Nhóm                  | Ca cụ thể                                                                    | Hành vi mong đợi                                                                                                                | AC                  |
| --------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Rỗng/null             | câu hỏi rỗng; không có nguồn; `answer: null`; trích dẫn rỗng                 | `ValidationError`; `no_evidence`; `insufficient`; `invalid_output`                                                              | AC-02, AC-03, AC-10 |
| Cực đại/độ dài        | câu hỏi > 1000; câu trả lời > 4000; lời nhắc > 200.000 byte; `topK` 99       | từ chối; loại; từ chối trước khi gửi; kẹp 8                                                                                     | AC-01, AC-03, AC-10 |
| Trùng lặp/idempotency | trích dẫn lặp `[1,1]`; che PII chạy lại                                      | gộp còn một; kết quả không đổi (lũy đẳng)                                                                                       | AC-03, AC-09        |
| Song song             | nhiều lượt cùng workspace chạm trần ngân sách                                | mỗi lượt đếm lại nhật ký trước khi gửi; không khoá dòng nên các lượt đồng thời có thể vượt trần một ít (chưa có test đồng thời) | AC-08               |
| Mất mạng giữa chừng   | mô hình hết giờ (60 giây), mất kết nối, trả 5xx hay phản hồi không phải JSON | nhật ký `error` kèm mã an toàn; người dùng thấy "thử lại sau"                                                                   | AC-07               |
| Thời gian/múi giờ     | ngân sách cửa sổ 24 giờ trượt theo giờ CSDL                                  | lượt cũ hơn 24 giờ không tính                                                                                                   | AC-08               |
| Quyền                 | người ngoài; đám mây chưa đồng ý; admin/member bật cờ                        | Forbidden; `AiNotAllowedError`; chỉ owner đổi cờ                                                                                | AC-06, AC-10        |
| Tiền/đơn vị           | số tiền trong nguồn ("200k"); byte UTF-8 của tiếng Việt                      | không che số tiền; đếm byte theo UTF-8                                                                                          | AC-07, AC-09        |

## 4. Dữ liệu

| Thực thể         | Trường                                                                                                       | Kiểu             | Ràng buộc                                                             | Ai đọc/ghi  |
| ---------------- | ------------------------------------------------------------------------------------------------------------ | ---------------- | --------------------------------------------------------------------- | ----------- |
| `ai_disclosures` | `actor_id`, `purpose`, `endpoint_host`, `model`, `local`, `item_count`, `bytes_sent`, `status`, `error_code` | text/int/boolean | CHECK trạng thái, số không âm, mã lỗi an toàn; cascade theo workspace | cổng AI ghi |
| `workspaces`     | `ai_cloud_enabled` (mặc định `false`)                                                                        | boolean          | —                                                                     | owner ghi   |

- Nhật ký không có nội dung và chưa có hạn tự xoá (giữ tới khi xoá workspace, PROJECT.md §5).

## 5. Giao diện / API

- `/app/<workspace>/search`: khối "Hỏi đáp có trích dẫn" với thông báo AI (`data-ai-disclosure`); form hỏi chỉ hiện khi AI bật; Server Action `askAction` trả câu trả lời + trích dẫn hoặc nhãn lý do (`UNANSWERED_LABEL`).
- Biến môi trường: `AI_BASE_URL` (http/https, không nhận link-local/metadata), `AI_MODEL` (bắt buộc khi có `AI_BASE_URL`), `AI_API_KEY` (bí mật, tuỳ chọn).

## 6. Lỗi

| Mã lỗi                           | Khi nào                              | HTTP/exit code                       | Thông điệp cho người dùng                                        | AC          |
| -------------------------------- | ------------------------------------ | ------------------------------------ | ---------------------------------------------------------------- | ----------- |
| `ai_disabled`                    | `AI_BASE_URL` trống                  | `AiDisabledError`                    | "AI chưa được bật trên máy chủ này…"                             | AC-05       |
| `cloud_not_enabled`              | đám mây chưa bật hoặc chưa có đồng ý | `AiNotAllowedError`                  | "Workspace chưa cho phép gửi dữ liệu tới AI đám mây…"            | AC-06       |
| `ai_budget_exceeded`             | vượt ngân sách 24 giờ                | `AiBudgetError`                      | chưa có lời nhắn riêng: lỗi rơi về trang lỗi chung của workspace | AC-08       |
| `model.timeout` / `model.*`      | mô hình chậm / lỗi                   | `ModelError`                         | "phản hồi quá chậm" / "không gọi được mô hình AI. Thử lại sau."  | AC-07       |
| `no_evidence` … `human_required` | không trả lời được                   | `answered: false`                    | nhãn theo lý do                                                  | AC-02–AC-04 |
| `validation` / `forbidden`       | đầu vào sai / người ngoài            | `ValidationError` / `ForbiddenError` | thông điệp cụ thể / không có quyền                               | AC-10       |

## 7. Yêu cầu phi chức năng của tính năng

| Thuộc tính | Ngưỡng                                                       | Nguồn                  | Cách đo                                                   |
| ---------- | ------------------------------------------------------------ | ---------------------- | --------------------------------------------------------- |
| Bảo mật    | 0 byte rời máy khi chưa đồng ý; 0 nội dung trong nhật ký/log | ADR-0005, CMP-PRIV-010 | `tests/ai/gateway.test.ts`, `tests/ai/guardrails.test.ts` |
| Chi phí    | trần 500 lượt / 20 MB / 300 lượt mỗi mục đích mỗi 24 giờ     | OPS-COST-004           | `tests/ai/budget.test.ts`                                 |
| Chất lượng | recall@5 của truy xuất đạt ngưỡng bộ 50 câu                  | D-028                  | `tests/eval/qa.test.ts`                                   |

## 8. Hành vi AI

- **Mô hình:** không ghim sẵn. Máy chủ dùng đúng mô hình đặt ở `AI_MODEL` qua một điểm cuối tương thích OpenAI `POST {AI_BASE_URL}/chat/completions` (Ollama, vLLM hoặc dịch vụ đám mây tương thích); adapter tự viết bằng `fetch`, chưa dùng AI SDK (D-014). Tham số cố định: `temperature: 0`, `max_tokens: 800` cho hỏi đáp, hết giờ 60 giây; một lượt system + user, mô hình không có công cụ nào.
- **Điều kiện dùng:** AI chỉ chạy khi `AI_BASE_URL` có giá trị (mặc định trống = tắt). Điểm cuối cục bộ dùng ngay; điểm cuối đám mây chỉ khi owner bật `ai_cloud_enabled` kèm bản ghi đồng ý đang hiệu lực, còn ngân sách, và sau khi che PII. Mỗi lượt có dòng nhật ký trước khi gửi.
- **Đầu vào không tin cậy:** tin nhắn, tài liệu, issue GitHub trong kho; đóng khung là DỮ LIỆU bằng ranh giới ngẫu nhiên mỗi lượt, lời nhắc hệ thống dặn bỏ qua chỉ thị trong nguồn, nonce bị xoá khỏi nội dung nguồn.
- **Khi model sai/không chắc:** mọi kiểm bằng mã (schema, trích dẫn, kiểm đầu ra, lý do dừng); sai thì không hiển thị câu trả lời (AC-03); thiếu thông tin thì `insufficient`.
- **Tiêu chí eval:** bộ 50 câu `tests/eval/` (khoá băm, recall@5, câu không đáp án trả rỗng) chạy không cần khoá mô hình (D-028).

## 9. Đo lường

- Log `gen_ai.client.operation` (OTel GenAI: nhà cung cấp, mô hình yêu cầu/phục vụ, token vào/ra, lý do dừng, thời gian, số PII đã che); chỉ số token theo workspace, tính năng, mô hình (`addLlmTokens`).

## 10. Câu hỏi mở

- [x] Phạm vi lớp AI và cách gọi mô hình? — [không chặn] — Đã quyết: D-014 (phiên chính, 2026-11-22) — cổng `ModelPort` + adapter tương thích OpenAI bằng `fetch`, AI tắt mặc định, đám mây bật theo workspace kèm nhật ký.
- [x] Có làm hạ tầng tác tử (công cụ, agent con)? — [không chặn] — Đã quyết: D-029 (phiên chính, 2026-11-24) — không; mô hình chỉ đọc chữ, trả chữ (AC-11, `tests/ai/agent-boundary.test.ts`).
- [x] Vượt ngân sách chưa có lời nhắn riêng ở giao diện, spec ghi gì? — [không chặn] — Đã quyết: D-041 (phiên chính, 2026-11-24) — spec ghi đúng hành vi hiện tại (mục 6); thêm lời nhắn là việc riêng, báo phiên chính.

## 11. DoR / DoD

- DoR: spec Approved · 0 câu hỏi chặn · phụ thuộc rõ (F-007 truy xuất, F-009 đồng ý) · đủ nhỏ cho một PR · mỗi task có Gate.
- DoD: mọi AC có test chứa `F-008/AC-xx` và xanh · ca biên có test · cổng xanh · blueprint tick có bằng chứng.

## 12. Truy vết

| AC    | Test (tên chứa `F-008/AC-xx`)                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------- |
| AC-01 | `tests/ai/answer.test.ts`, `tests/ai/transparency.test.ts`                                              |
| AC-02 | `tests/ai/answer.test.ts`                                                                               |
| AC-03 | `tests/ai/answer.test.ts`, `tests/ai/guardrails.test.ts`, `tests/ai/guard.test.ts`                      |
| AC-04 | `tests/ai/guard.test.ts`, `tests/ai/guardrails.test.ts`                                                 |
| AC-05 | `tests/ai/gateway.test.ts`, `tests/ai/answer.test.ts`, `tests/config/env.test.ts`, `e2e/search.spec.ts` |
| AC-06 | `tests/ai/gateway.test.ts`, `tests/ai/answer.test.ts`, `tests/ai/model.test.ts`                         |
| AC-07 | `tests/ai/gateway.test.ts`                                                                              |
| AC-08 | `tests/ai/budget.test.ts`                                                                               |
| AC-09 | `tests/ai/guardrails.test.ts`, `tests/ai/redact.test.ts`                                                |
| AC-10 | `tests/ai/answer.test.ts`, `tests/ai/gateway.test.ts`                                                   |
| AC-11 | `tests/ai/transparency.test.ts`                                                                         |

- Task: đợt xw-3 (D-014), harden AI (D-028, D-029), spec bù theo D-041 · Kiểm: `npx vitest run tests/config/specs.test.ts`.

## Thay đổi

| Phiên bản | Ngày       | Gì                        | Vì sao                                  | Duyệt |
| --------- | ---------- | ------------------------- | --------------------------------------- | ----- |
| 1         | 2026-11-24 | tạo spec bù theo mã đã có | AUD-HAR-013: tính năng có mã, chưa spec | D-041 |
