# Nghiên cứu bổ sung cho kế hoạch X-Workspace

- Ngày kiểm: 2026-11-22. Mọi dữ kiện lấy từ nguồn sống (registry npm, tài liệu chính thức) qua subagent `researcher`.
- Mức bằng chứng: **registry** = đọc JSON registry trực tiếp; **docs** = trang tài liệu chính thức được tóm tắt lại (nguồn thứ cấp: phải đối chiếu lại bằng mã hoặc khoá thật trước khi coi là hợp đồng).
- Dùng cho: `docs/work/2026-11-22-x-workspace-plan/working.md`, các ADR từ 0002 trở đi.

## 1. SocialAPI (kênh tin nhắn của MVP)

Nguồn: `https://docs.social-api.ai` (guides/direct-messages, pagination, ids, webhooks, webhook-events, delivery, rate-limits, errors, changelog). Base `https://api.social-api.ai/v1`, `Authorization: Bearer <token>`. Mức bằng chứng: docs. Chưa đối chiếu `api-reference/openapi.json` và chưa thử bằng khoá thật.

| Chủ đề            | Dữ kiện                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ID                | Account `acc_…` (ổn định suốt đời kết nối). Conversation = UUID. Message trong danh sách = UUID và có `platform_id`. Sự kiện webhook DM mang `id` dạng `sapi_dm_…`. Tài liệu bảo coi mọi ID là chuỗi mờ.                                                                                                                                             |
| Liệt kê hội thoại | `GET /inbox/conversations`: query `account_id`, `platform`, `status` (`active` mặc định / `archived`), `limit` (mặc định 25, tối đa 100), `cursor`. Không có `since`. Phản hồi có `pagination{limit,has_more,next_cursor}`, `sync_state` (`idle`/`syncing`/`failed`), `last_synced_at`. Thứ tự: hoạt động gần nhất trước.                            |
| Trường hội thoại  | `id`, `account_id`, `page_id`, `platform`, `platform_id`, `participant_id`, `participant_name`, `participant_picture`, `last_message`, `last_message_at`, `status`, `unread_count`, `created_at`, `updated_at`.                                                                                                                                      |
| Liệt kê tin nhắn  | `GET /inbox/conversations/{conversation_id}/messages`: `limit` (mặc định 25, tối đa 200), `cursor`. Thứ tự: mới nhất trước.                                                                                                                                                                                                                          |
| Trường tin nhắn   | `id`, `conversation_id`, `platform_id`, `direction` (`incoming`/`outgoing`), `text` (tin chỉ có đính kèm là `[Attachment]`), `sender_id`, `sender_name`, `attachment_type`, `attachment_url`, `reply_to`, `status` (chỉ tin gửi đi: `pending`/`sent`/`delivered`/`read`/`failed`), `status_updated_at`, `created_at`. Không có trường đã sửa/đã xoá. |
| Gửi tin           | `POST /inbox/conversations/{conversation_id}/messages`, body `account_id` (bắt buộc), `text`, `attachments[]`, `reply_to_message_id`, `message_tag`. Phản hồi `success`, `message_ids[]` (ID của SocialAPI; Zalo trả chuỗi rỗng). Không có `status` trong phản hồi. Mỗi lần gửi tốn 1 credit, đọc không tốn.                                         |
| Idempotency       | Tài liệu **không nêu** header `Idempotency-Key` cho gửi tin. Gửi lại sau timeout có thể tạo tin trùng.                                                                                                                                                                                                                                               |
| Lỗi cửa sổ nhắn   | `400 platform.instagram.window_closed`, `400 platform.facebook.window_closed`, `400 whatsapp.window_closed`, `422 platform.zalo.not_deliverable`, `403 telegram.cannot_message`. Cửa sổ: Instagram/Facebook 24 giờ từ tin cuối của người dùng (Instagram Login có `HUMAN_AGENT` 7 ngày), WhatsApp 24 giờ, Zalo 7 ngày.                               |
| Giới hạn nội dung | Facebook 2.000 ký tự; Instagram 1.000 byte UTF-8. X và Bluesky chỉ gửi văn bản.                                                                                                                                                                                                                                                                      |
| Webhook           | Sự kiện DM: `dm.received`, `dm.sent`, `dm.referral`, `dm.postback`, `dm.deleted`, `dm.status.sent/delivered/read/failed`. Ngoài ra `comment.received`, `mention.received`, `review.received/updated`, `post.*`, `account.connected/disconnected/updated`, `page.removed`.                                                                            |
| Thân webhook DM   | `data.id` (`sapi_dm_…`), `data.account_id` (`acc_…`), `data.conversation_id` (UUID; vắng trên Zalo), `data.platform_id` (id tin của nền tảng; vắng trên Zalo và `dm.referral`), `author.id`, `recipient.id`, `content.text`, `received_at`. Khớp với danh sách tin nhắn qua `platform_id`, không qua `id`.                                           |
| Header webhook    | `X-SocialAPI-Event`, `X-SocialAPI-Timestamp`, `X-SocialAPI-Signature-V2`, `X-SocialAPI-Delivery` (ổn định qua các lần gửi lại tự động; gửi lại thủ công có ID mới). Thân không có event id.                                                                                                                                                          |
| Gửi lại webhook   | Cần 2xx trong 10 giây; tối đa 10 lần trong khoảng 14 giờ; giao ít nhất một lần, có thể sai thứ tự.                                                                                                                                                                                                                                                   |
| Bài đăng          | Trạng thái bài: `draft`, `scheduled`, `publishing`, `published`, `partial`, `failed`, `cancelled`. Trạng thái từng đích: `pending`, `publishing`, `published`, `failed`, `unpublished`. `GET /posts/{post_id}` trả `status` và `targets[]` (`platform_post_id`, `permalink`, `published_at`, `error{code,…}`).                                       |
| Tần suất          | 60 yêu cầu/phút (0–2 tài khoản), 600 (3–2.000). Header `X-RateLimit-*`; 429 có `Retry-After`.                                                                                                                                                                                                                                                        |
| Lỗi               | `{ "error": { "code", "message", "meta"? }, "request_id" }`. Từ 2026-11-12 lỗi phía nền tảng trả 503. `token_expired` → `403 account.reconnection_required`.                                                                                                                                                                                         |

Hệ quả cho thiết kế:

1. Adapter hiện tại chỉ lấy `last_message` của 50 hội thoại và dùng id hội thoại làm khoá, nên tin mới của hội thoại cũ bị bỏ qua. Phải tách hội thoại và tin nhắn, đọc `…/messages` có `cursor`.
2. Ba loại id của cùng một tin (UUID, `platform_id`, `sapi_dm_…`) buộc khoá khử trùng phải là `platform_id` khi có; Zalo không có `platform_id` nên cần khoá dự phòng.
3. Gửi tin không có idempotency phía dịch vụ: bắt buộc có sổ hành động, trạng thái `send_unknown` và đối soát bằng cách đọc lại danh sách tin trước khi cân nhắc gửi lại.
4. `publishing` không phải `published`; có thêm `partial`. Phải đọc lại `GET /posts/{id}` để xác nhận.
5. Webhook không có event id trong thân: khử trùng bằng `X-SocialAPI-Delivery` cộng khoá tự nhiên của đối tượng.

## 2. AI SDK, kiểm thử và tìm kiếm

| Thành phần           | Dữ kiện                                                                                                                                                                                                                                                    | Nguồn          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `ai` (Vercel AI SDK) | 7.0.179 (2026-11-20), Apache-2.0, Node ≥ 22, peer `zod` `^3.25.76 \|\| ^4.1.8`.                                                                                                                                                                            | registry       |
| Gói provider         | `@ai-sdk/anthropic` 4.0.107, `@ai-sdk/openai` 4.0.122, `@ai-sdk/google` 4.0.124, `@ai-sdk/openai-compatible` 3.0.94. Giấy phép từng gói chưa đọc.                                                                                                          | registry       |
| API bản 7            | `generateText` giữ tên; `system` → `instructions`; đầu ra có cấu trúc qua `output: Output.object({ schema })`; tool dùng `inputSchema`; giới hạn bước `stopWhen: isStepCount(n)`; `usage` là tổng mọi bước (`inputTokens`, `outputTokens`, `totalTokens`). | docs           |
| Kiểm thử             | `ai/test` có `MockLanguageModelV4`; `doGenerate` trả `content`, `finishReason`, `usage`, `warnings`. Hình dạng chính xác phải đọc từ `.d.ts` của gói.                                                                                                      | docs           |
| PGlite 0.5.17        | Có `@electric-sql/pglite/contrib/unaccent`, `…/contrib/pg_trgm`, `…/contrib/fuzzystrmatch`. `vector` ở gói riêng `@electric-sql/pglite-pgvector` 0.0.18.                                                                                                   | registry, docs |
| pgvector             | v0.8.7, PostgreSQL License; image `pgvector/pgvector:pg16` có.                                                                                                                                                                                             | registry       |
| PostgreSQL           | Hết hỗ trợ: 16 = 2028-11-09, 17 = 2029-11-08, 18 = 2030-11-14.                                                                                                                                                                                             | docs           |
| promptfoo            | 0.126.0 (2026-11-18), MIT, Node ≥ 22.22.0.                                                                                                                                                                                                                 | registry       |
| pg-boss              | 12.39.0, MIT. `send(..., { db })` nhận adapter `executeSql(text, values)` để chèn job trong cùng giao dịch; `retryLimit` mặc định 2; job xong bị xoá sau 7 ngày theo mặc định.                                                                             | registry, docs |
| Ollama               | Điểm cuối tương thích OpenAI `http://localhost:11434/v1/`, có tool calling và `/v1/embeddings`.                                                                                                                                                            | docs           |
| Embedding đa ngữ     | `BAAI/bge-m3` (MIT, 1024 chiều), `intfloat/multilingual-e5-large` (MIT, 1024 chiều). Hỗ trợ tiếng Việt chưa xác minh từ thẻ model.                                                                                                                         | docs           |

Hệ quả cho thiết kế:

1. Sổ hành động không được dựa vào bảng job của pg-boss vì job xong bị xoá sau 7 ngày.
2. Tìm kiếm bước đầu dùng full-text của Postgres cộng `unaccent` và `pg_trgm`; cả hai chạy được trên PGlite nên kiểm thử được trong cổng.
3. Lớp AI phải nằm sau một adapter của dự án: bản 7 của AI SDK đổi tên nhiều API so với bản 5 và 6.

## 3. Agent Desktop và trình duyệt (cho X-Workspace Companion)

Nguồn: `https://agent-browser.dev/desktop` (commands, json-output, snapshots-and-refs, guides/mcp, guides/observe-act-verify, guides/traces, platforms/windows), registry npm. Mức bằng chứng: docs và registry. Chưa cài và chưa chạy trên Windows.

| Chủ đề             | Dữ kiện                                                                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gói                | npm `agent-desktop` 1.3.1 (2026-11-13), Apache-2.0, repo `vercel-labs/agent-desktop`, có provenance SLSA; lệnh `agent-desktop`. Có script postinstall tải binary native.                 |
| Windows            | Windows 10 1809+ hoặc Server 2019+, x64 hoặc ARM64, dùng UI Automation. Binary **không ký**: SmartScreen hoặc Smart App Control có thể chặn.                                             |
| Không hỗ trợ       | Session 0, secure desktop (UAC, màn hình đăng nhập), màn hình khoá, phiên của người dùng khác. App chạy quyền admin thì đọc được nhưng không điều khiển được (`PERM_DENIED`).            |
| Lệnh chính         | `list-apps`, `list-windows`, `focus-window`, `snapshot`, `find`, `click`, `type`, `set-value`, `press`, `screenshot`, `wait`, `status`.                                                  |
| Đầu ra             | Mỗi lệnh in đúng một phong bì JSON: `version`, `ok`, `command`, `data` hoặc `error{code,message,disposition{delivery,retry},…}`. Mã thoát 0 thành công, 1 lỗi có cấu trúc, 2 lỗi đối số. |
| Tham chiếu phần tử | `@<snapshot_id>:eN`; `@e6` trần bị từ chối. Mã lỗi: `STALE_REF`, `SNAPSHOT_NOT_FOUND`, `AMBIGUOUS_TARGET`, `WINDOW_NOT_FOUND`, `PERM_DENIED`, `INVALID_ARGS`, `INTERNAL`.                |
| Chọn đích          | `--app` và `--window-id`; mơ hồ thì `AMBIGUOUS_TARGET` kèm tối đa 10 ứng viên. Snapshot trả `data.app`, `data.window{id,title}`, `snapshot_id`, cờ `identity_unproven`.                  |
| Snapshot           | Độ sâu mặc định 10 (tối đa 50); `-i` chỉ lấy phần tử tương tác và **bỏ static text**; `data` có `complete`, `truncated`, `nodes_observed`.                                               |
| Xác minh           | Tài liệu ghi rõ `ok: true` không chứng minh hành động có tác dụng. `delivery`: `delivered_verified`, `delivered_unverified`, `not_delivered`. Chỉ thử lại khi `retry: safe`.             |
| MCP                | `agent-desktop mcp` (stdio), tool tên `desktop_<lệnh>`. Không có danh sách cho phép/chặn tool; `desktop_launch` chạy được mọi chương trình trên PATH.                                    |
| Trace              | Giới hạn 32 MiB, 100.000 sự kiện. Văn bản bị che, nhưng ảnh chụp và HTML xuất ra **không bị che**.                                                                                       |
| agent-browser      | 0.43.0, Apache-2.0. `--allowed-domains` bị từ chối khi kết hợp với `--cdp`, `--auto-connect`, `--profile`, `--restore`, `--state`.                                                       |

Hệ quả cho thiết kế:

1. Companion gọi CLI (không dùng MCP) qua một danh sách lệnh cho phép do dự án kiểm soát, vì MCP không hạn chế được tool và có `desktop_launch`.
2. Mỗi tác vụ ghi phải kèm danh tính đích (`app`, `window.id`, `window.title`) lấy từ snapshot ngay trước thao tác; `identity_unproven` hoặc `AMBIGUOUS_TARGET` thì dừng.
3. Kết quả `delivered_unverified` hoặc mất phản hồi sau khi gửi được ghi là `send_unknown`, không tự thử lại.
4. Đọc nội dung hội thoại phải dùng snapshot không có `-i`.
5. Không đưa ảnh trong trace của công cụ vào kho; ảnh làm bằng chứng do Companion chụp có chủ đích và gửi về hub.

## 4. GitHub REST (nguồn dự án pilot)

Nguồn: `https://docs.github.com/en/rest`. Mức bằng chứng: docs.

| Chủ đề        | Dữ kiện                                                                                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issues        | `GET /repos/{o}/{r}/issues`: `state=all`, `since` (theo thời điểm cập nhật), `sort`, `direction`, `per_page` tối đa 100. Trả cả PR (có khoá `pull_request`).                           |
| Pulls         | `GET /repos/{o}/{r}/pulls`: `state`, `sort=updated`, `direction`, `per_page` 100. **Không có `since`**.                                                                                |
| Check runs    | `GET /repos/{o}/{r}/commits/{ref}/check-runs`: `filter=latest\|all`, `per_page` 100.                                                                                                   |
| Tần suất      | Token cá nhân 5.000 yêu cầu/giờ; header `x-ratelimit-limit/remaining/reset`; vượt thì 403 hoặc 429, có `retry-after` thì chờ đúng số giây. Giới hạn phụ: tối đa 100 yêu cầu đồng thời. |
| ETag          | `If-None-Match` trả 304 không tính vào hạn mức chính khi có header xác thực.                                                                                                           |
| Events API    | Tối đa 300 sự kiện trong 30 ngày, trễ tới 6 giờ: không đủ làm kho lịch sử.                                                                                                             |
| Webhook       | GitHub **không tự gửi lại** lần giao thất bại; có API gửi lại. Chữ ký `X-Hub-Signature-256` = `sha256=` + HMAC-SHA256 của thân thô.                                                    |
| Phiên bản API | `X-GitHub-Api-Version: 2026-03-10` là mới nhất; `2022-11-28` còn hỗ trợ tới 2028-03-10.                                                                                                |
| Quyền token   | Issues, Pull requests, Contents, Commit statuses, Deployments, Metadata: chỉ đọc. Quyền đọc check-runs của token fine-grained chưa xác minh.                                           |

Chưa xác minh: tham số của pull reviews, issue comments cấp repo, commits, statuses, releases, deployments.

Hệ quả cho thiết kế: nhập lịch sử bằng API theo từng loại đối tượng với con trỏ `since`/`updated`, định kỳ đối soát; webhook chỉ để tăng tốc, không phải nguồn duy nhất.

## 5. Ghép nối thiết bị (RFC 8628)

Nguồn: `https://www.rfc-editor.org/rfc/rfc8628.txt`. Tham số: `device_code`, `user_code`, `verification_uri`, `expires_in`, `interval` (mặc định 5 giây); lỗi khi hỏi vòng: `authorization_pending`, `slow_down`, `access_denied`, `expired_token`. Mục 5.1 yêu cầu giới hạn số lần thử `user_code`; ví dụ 8 ký tự trên bảng 20 chữ cái (`BCDFGHJKLMNPQRSTVWXZ`) cho khoảng 34,5 bit. Mục 5.2 yêu cầu `device_code` có entropy rất cao. Mục 5.4 khuyến nghị nói rõ với người dùng rằng họ đang uỷ quyền một thiết bị.

## 6. Luật, chính sách nền tảng và bảo mật AI

Đây là dữ kiện trích từ nguồn, không phải tư vấn pháp lý. Điều khoản Luật 91 lấy từ bản dịch và bài tóm tắt (nguồn thứ cấp), phải đối chiếu số điều với văn bản chính thức trước khi trích dẫn ra ngoài.

| Chủ đề                                   | Dữ kiện                                                                                                                                                                                                                                                                                                                                                                                    | Mức     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15 | Thông qua 2025-06-26, hiệu lực 2026-01-01. Nghị định hướng dẫn 356/2025/NĐ-CP (hiệu lực 2026-01-01); nghị định xử phạt 330/2026/NĐ-CP (2026-08-19).                                                                                                                                                                                                                                        | thứ cấp |
| Đồng ý và quyền                          | Đồng ý phải rõ ràng, theo từng mục đích; im lặng không phải đồng ý. Chủ thể có quyền rút đồng ý, yêu cầu xoá, hạn chế, phản đối. Số ngày đáp ứng chưa xác minh (gia hạn một lần, không quá 15 ngày).                                                                                                                                                                                       | thứ cấp |
| Thời hạn lưu                             | Chỉ lưu trong thời gian cần cho mục đích xử lý, trừ khi luật khác quy định.                                                                                                                                                                                                                                                                                                                | thứ cấp |
| Thông báo vi phạm                        | Trong 72 giờ kể từ khi phát hiện, với vi phạm có khả năng gây hại.                                                                                                                                                                                                                                                                                                                         | thứ cấp |
| Chuyển dữ liệu ra nước ngoài             | Gửi hồ sơ đánh giá tác động trong 60 ngày kể từ lần chuyển đầu tiên; thiếu hồ sơ bị phạt 30–50 triệu đồng và có thể bị đình chỉ chuyển dữ liệu.                                                                                                                                                                                                                                            | thứ cấp |
| Xử lý bằng AI                            | Phải phân loại mức rủi ro để áp biện pháp bảo vệ tương xứng.                                                                                                                                                                                                                                                                                                                               | thứ cấp |
| Miễn trừ                                 | Hộ kinh doanh và doanh nghiệp siêu nhỏ được miễn một số nghĩa vụ, **trừ khi** cung cấp dịch vụ xử lý dữ liệu, xử lý dữ liệu nhạy cảm hoặc dữ liệu của số lượng lớn chủ thể.                                                                                                                                                                                                                | thứ cấp |
| Messenger                                | Cửa sổ nhắn tin chuẩn 24 giờ; thẻ Human Agent cho phép người trả lời thủ công trong 7 ngày; trải nghiệm tự động phải công bố là dịch vụ tự động khi luật yêu cầu, Meta khuyến nghị công bố cả khi không bắt buộc.                                                                                                                                                                          | docs    |
| Zalo OA                                  | Tin tư vấn miễn phí trong 48 giờ kể từ tương tác cuối; API gửi được trong 7 ngày.                                                                                                                                                                                                                                                                                                          | docs    |
| OWASP LLM Top 10 (2025)                  | LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure, LLM05 Improper Output Handling, LLM06 Excessive Agency, LLM10 Unbounded Consumption. Biện pháp chính thức: đặc quyền tối thiểu, tách nội dung ngoài không tin cậy, kiểm định dạng đầu ra, kiểm quyền ở hệ thống hạ nguồn, người duyệt hành động rủi ro cao. Tài liệu ghi rõ hạn chế bằng system prompt có thể bị vượt qua. | docs    |
| Dữ liệu gửi AI cloud                     | Anthropic API và OpenAI API mặc định không huấn luyện trên dữ liệu API, lưu tối đa khoảng 30 ngày (có ngoại lệ); không lưu (ZDR) cần thoả thuận riêng. Gemini trả phí không dùng để cải thiện sản phẩm nhưng có thể lưu tạm ở bất kỳ nước nào.                                                                                                                                             | docs    |
| Sao lưu                                  | `pg_dump` cho bản sao nhất quán của một database, không kèm role (cần `pg_dumpall --globals-only`). PITR cần base backup và chuỗi WAL liên tục. Quy tắc 3-2-1: ba bản, hai loại phương tiện, một bản ngoài địa điểm chính.                                                                                                                                                                 | docs    |
| Tiếng Việt trong full-text search        | `unaccent` bỏ dấu rồi chuyển cho từ điển kế; file luật đi kèm được mô tả là cho ngôn ngữ châu Âu. Không tìm thấy bộ tách từ tiếng Việt chính thức.                                                                                                                                                                                                                                         | docs    |

Hệ quả cho thiết kế:

1. Lưu dài hạn tin nhắn của khách là xử lý dữ liệu cá nhân của bên thứ ba: thời hạn lưu phải cấu hình được theo workspace và theo lớp dữ liệu, có đường xoá theo yêu cầu đi xuyên bản gốc, chỉ mục, bản tổng hợp và bản xuất. "Giữ mãi" không phải mặc định cho dữ liệu của khách; nó là lựa chọn của chủ workspace kèm trách nhiệm pháp lý của họ.
2. Gửi trích đoạn cho AI cloud nước ngoài là chuyển dữ liệu ra nước ngoài: mặc định tắt, bật theo workspace, có nhật ký dữ liệu đã gửi; cấu hình AI cục bộ (điểm cuối tương thích OpenAI) là đường tự host.
3. Tự trả lời phải tôn trọng cửa sổ nhắn tin của nền tảng (lỗi `window_closed` là trạng thái `blocked`, không thử lại) và có tuỳ chọn công bố là trả lời tự động.
4. Chống prompt injection bằng mã: nội dung tin đến, tài liệu, trang web chỉ là dữ liệu; quyền gửi, người nhận và phạm vi do dịch vụ kiểm, không do model quyết.
5. `unaccent` mặc định có thể không phủ hết dấu tiếng Việt: phải có bộ kiểm thử có dấu và không dấu, và hàm bỏ dấu riêng nếu thiếu.

## 7. Dữ kiện chưa xác minh (không được dùng làm căn cứ)

- Hợp đồng SocialAPI chưa đối chiếu `openapi.json` và chưa thử bằng khoá thật.
- Agent Desktop chưa chạy trên Windows; quyền đọc check-runs của token fine-grained; tham số một số endpoint GitHub.
- Hình dạng `usage` của mock trong `ai/test`; `unaccent` có phủ đủ dấu tiếng Việt hay không (sẽ đo bằng test).
- Số ngày đáp ứng yêu cầu xoá theo Nghị định 356/2025; toàn văn các nghị định.
- Hỗ trợ tiếng Việt của model embedding; giấy phép `pg_bigm`, `pgroonga`.
