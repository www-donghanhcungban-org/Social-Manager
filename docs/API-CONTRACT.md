# API-CONTRACT — X-Workspace HTTP · phiên bản API v1 · hợp đồng phiên bản 1.0.0 · 2026-11-24

> File máy đọc (nguồn sự thật): [`docs/openapi.yaml`](openapi.yaml) (OpenAPI 3.1.1). Kiểm: `npx vitest run tests/config/api-contract.test.ts` (so khớp path + method với `app/**/route.ts`, mã trạng thái trong mã, khung YAML, `$ref`, chặn thay đổi phá vỡ trong cùng major, bảng Server Action bên dưới).
> Base URL: cùng origin với bản tự host, **không** có tiền tố `/v1` trong URL (phiên bản nằm ở `info.version` của OpenAPI và tiêu đề tệp này).
> Xác thực: cookie phiên Better Auth (người dùng) · Bearer `METRICS_TOKEN` (`/api/metrics`) · chữ ký HMAC (webhook) · công khai (`security: []`) cho health và đường dẫn Better Auth. Nhà: `src/auth/`, `src/observability/metrics-auth.ts`, `src/providers/socialapi/webhook.ts`.
> Mẫu: `.xtemplates/framework/templates/API-CONTRACT.md`. Bản đồ render của route: [`ROUTES.md`](ROUTES.md).

## 1. Nguyên tắc chung

- Định dạng: JSON UTF-8 (trừ `/api/metrics`: văn bản Prometheus 0.0.4). Thời gian ISO 8601 kèm múi giờ, lưu UTC (`timestamptz`). ID: UUID.
- Lớp chung `proxy.ts` cho mọi phản hồi: CSP có nonce, header bảo mật, `Cache-Control: private, no-store` cho tiền tố `/api` và `/app`. Request đổi trạng thái (POST/PUT/PATCH/DELETE) cross-site bị chặn **403** `text/plain` `Forbidden` trước khi tới handler (`src/security/csrf.ts`: theo `Sec-Fetch-Site`; thiếu thì so `Origin` với `Host`; thiếu cả hai mà có cookie cũng chặn). Webhook server-tới-server không gửi các header đó nên đi qua.
- Phân trang: không có endpoint HTTP danh sách nào (danh sách render ở Server Component).
- Rate limit: chỉ có ở Better Auth (`/api/auth/*`), bộ nhớ tiến trình, cửa sổ 60 s: mặc định 100 request/IP; `sign-in/email` và `sign-up/email` theo `AUTH_RATE_LIMIT_PER_MIN` (mặc định 10). Vượt → **429** thân `{"message": …}` + header `X-Retry-After` (giây). Thêm khoá theo tài khoản khi đăng nhập sai: 429 `code = TOO_MANY_ATTEMPTS`. Các route khác **không** có rate limit trong mã (giả định đứng sau reverse proxy; xem §8).
- Idempotency: §5.
- Phiên bản và thay đổi phá vỡ: §6.

## 2. Endpoint (route handler)

| Method | Path                                     | Mục đích                                                   | Quyền                                              | Request                                     | Thành công                                                        | Lỗi có thể                                                                       |
| ------ | ---------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| GET    | `/api/health`                            | Readiness: ping CSDL (thời hạn 2 s)                        | công khai                                          | —                                           | 200 `Health` `{status:"ok", version?}`, `Cache-Control: no-store` | 503 `{status:"degraded"}` (CSDL lỗi/treo, đang tắt êm)                           |
| GET    | `/api/health/live`                       | Liveness, không gọi phụ thuộc                              | công khai                                          | —                                           | 200 `{status:"ok"}`, `no-store`                                   | —                                                                                |
| GET    | `/api/metrics`                           | Metric Prometheus                                          | `Authorization: Bearer <METRICS_TOKEN>`            | —                                           | 200 `text/plain; version=0.0.4`, `no-store`                       | 401 `WWW-Authenticate: Bearer`; 404 khi chưa đặt token (≥ 24 ký tự)              |
| POST   | `/api/webhooks/socialapi/{connectionId}` | Nhận sự kiện hộp thư SocialAPI                             | chữ ký HMAC `x-socialapi-signature-v2` + timestamp | `SocialApiWebhookEvent`, thân thô ≤ 256 KiB | 200 `WebhookAck` `ok` (+ `inserted`) hoặc `ignored`               | 400 `invalid`, 401 `unauthorized`, 403 (proxy), 413 `too_large`, 500 `ErrorBody` |
| GET    | `/api/auth/{all}`                        | Better Auth (app dùng `get-session`)                       | công khai                                          | theo Better Auth 1.7.27                     | theo Better Auth                                                  | 429, lỗi Better Auth `{code?, message}`                                          |
| POST   | `/api/auth/{all}`                        | Better Auth (`sign-up/email`, `sign-in/email`, `sign-out`) | công khai (đăng nhập tạo phiên)                    | theo Better Auth 1.7.27                     | theo Better Auth; đăng nhập đặt cookie phiên                      | 403 (proxy), 429, lỗi Better Auth                                                |
| POST   | `/app/account/export`                    | Tải dữ liệu cá nhân của chính mình (STD-PRIV-004)          | cookie phiên; id lấy từ phiên                      | — (biểu mẫu `method="post"`)                | 200 tệp `du-lieu-cua-toi.json`, `private, no-store`, `nosniff`    | 401 `{error:"unauthorized"}`, 403 (proxy)                                        |

`/api/auth/{all}` là catch-all `[...all]` của Next.js (OpenAPI không biểu diễn được đoạn chứa `/`; đánh dấu `x-catch-all: true`). Hợp đồng chi tiết từng đường dẫn thuộc Better Auth, không chép lại để khỏi lệch khi nâng phiên bản thư viện.

## 3. Schema (tóm tắt — đầy đủ trong `docs/openapi.yaml`)

```yaml
Health: { status: ok | degraded, version?: string } # version chỉ khi dựng với APP_VERSION
WebhookAck:
  {
    status: ok | ignored | unauthorized | invalid | too_large,
    inserted?: integer >= 0,
  }
ErrorBody: { error: { code: string, message: string, request_id: uuid } }
```

## 4. Mô hình lỗi

Lỗi **không** theo RFC 9457 (`application/problem+json`); mô hình hiện tại của mã là JSON riêng theo từng loại route (giữ nguyên để không phá vỡ bên tiêu thụ; đổi sang RFC 9457 là thay đổi phá vỡ, cần major 2 — xem §6):

| Nguồn                              | Thân lỗi                                                 | Khi nào                                                                                                                                                                                                                                                                                                      |
| ---------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/http/errors.ts` `handleError` | `{"error": {"code", "message", "request_id"}}`           | Lỗi bất ngờ ở webhook → 500 `internal`. Bảng mã: 403 `forbidden`, 404 `not_found`, 409 = `reason` của ConflictError, 422 `validation`/`unsupported`, 501 `not_implemented`, 502 `upstream_error`, 504 `upstream_timeout`, 500 `internal`. Thông điệp tĩnh; không stack, đường dẫn, phiên bản, chuỗi kết nối. |
| Webhook                            | `{"status": "unauthorized" \| "invalid" \| "too_large"}` | 401 (một phản hồi cho mọi lý do xác thực thất bại, không dò được kết nối nào tồn tại), 400, 413.                                                                                                                                                                                                             |
| `/api/health`                      | `{"status": "degraded"}`                                 | 503; không lộ nguyên nhân.                                                                                                                                                                                                                                                                                   |
| `/api/metrics`                     | văn bản `Unauthorized` / `Not Found`                     | 401 / 404.                                                                                                                                                                                                                                                                                                   |
| `/app/account/export`              | `{"error": "unauthorized"}`                              | 401.                                                                                                                                                                                                                                                                                                         |
| `proxy.ts`                         | văn bản `Forbidden`                                      | 403 request đổi trạng thái cross-site.                                                                                                                                                                                                                                                                       |
| Better Auth                        | `{"code"?, "message"}`                                   | lỗi đăng nhập/đăng ký, 429.                                                                                                                                                                                                                                                                                  |

Lỗi không bắt ở `/app/account/export` và `/api/auth/*` rơi vào trang lỗi 500 mặc định của Next.js (không thuộc hợp đồng).

## 5. Idempotency

**HTTP (route handler).** Không route nào nhận header `Idempotency-Key`: không có endpoint HTTP tạo tài nguyên kiểu thanh toán/đặt hàng/gửi tin.

- `POST /api/webhooks/socialapi/{connectionId}` lũy đẳng theo nội dung sự kiện: khoá duy nhất `inbox_items(social_account_id, kind, external_id)` và `messages(social_account_id, external_id)`, chèn `ON CONFLICT DO NOTHING`. Gửi lại cùng sự kiện → 200 `ok` với `inserted: 0`, không tạo bản ghi thứ hai. Khoá nằm trong chính bản ghi ở Postgres (không hết hạn riêng). Phát lại ngoài cửa sổ timestamp 300 s → 401.
- `POST /app/account/export`: chỉ đọc dữ liệu + ghi một dòng kiểm toán mỗi lần; gọi lại cho cùng nội dung tải về, thêm một dòng kiểm toán.

**Server Action (thao tác có tác dụng ngoài).** Khoá lũy đẳng là trường biểu mẫu `idempotencyKey` (1–128 ký tự, sinh khi dựng trang), lưu ở Postgres theo khoá duy nhất `(workspace_id, idempotency_key)`, không hết hạn riêng:

| Action              | Cùng khoá + cùng yêu cầu                         | Cùng khoá + yêu cầu khác                                                                                                | Đua cùng khoá                                   |
| ------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `createPostAction`  | trả bài cũ (so `text` sau chuẩn hoá + tài khoản) | ConflictError `idempotency_conflict` → thông điệp lỗi trên form                                                         | chèn `ON CONFLICT DO NOTHING`, bên thua đọc lại |
| `requestSendAction` | trả hành động cũ (kể cả đã gửi xong)             | khoá dùng cho nháp khác → `idempotency_conflict`; nháp đã có hành động hiệu lực dưới khoá khác → `idempotency_conflict` | bên thua nhận dòng đã tạo (không trả 409)       |

Ánh xạ sang hợp đồng HTTP chuẩn (BE-API-008: thiếu khoá 400, payload khác 422, đang xử lý 409) **không áp dụng** vì đây không phải endpoint HTTP công khai; xem §8.

## 6. Phiên bản và thay đổi phá vỡ

- Phiên bản hợp đồng = `info.version` trong `docs/openapi.yaml` (SemVer 2.0.0), phải trùng phiên bản ở tiêu đề tệp này. Phiên bản API công khai = MAJOR (`v1`).
- **Phá vỡ** (bắt buộc tăng MAJOR, footer `BREAKING CHANGE:` trong commit, nhãn PR `breaking`): bỏ endpoint hoặc method; bỏ mã trạng thái đã khai; bỏ/đổi kiểu trường phản hồi; thêm trường bắt buộc vào request; siết ràng buộc đầu vào; đổi mô hình lỗi (ví dụ sang RFC 9457); đổi cơ chế xác thực hoặc tên header chữ ký.
- **Tương thích** (tăng MINOR/PATCH): thêm endpoint, thêm trường phản hồi tuỳ chọn, thêm mã trạng thái mới, nới ràng buộc, sửa mô tả.
- Cưỡng chế: `tests/config/api-contract.test.ts` giữ danh sách cơ sở của major hiện tại (`BASELINE[1]`: thao tác + mã trạng thái). Bỏ một mục cơ sở mà không tăng major là đỏ; tăng major thì phải khai cơ sở mới. Test cũng đỏ khi handler và OpenAPI lệch nhau (thiếu hay thừa path/method, mã trạng thái trong mã chưa khai). So sánh schema trường-theo-trường (oasdiff) chưa có trong CI — §8.
- Ngừng hỗ trợ: báo bằng header `Deprecation` (RFC 9745) và `Sunset` (RFC 8594) ít nhất một bản phát hành MINOR trước khi bỏ ở MAJOR kế tiếp.

## 7. Sự kiện / webhook

| Sự kiện                                                                  | Xử lý                                                                          | Payload                 | Ký/xác thực                                                                                       | Thử lại                                                          |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `comment.received`, `dm.received`, `mention.received`, `review.received` | ghi mục hộp thư; `dm.received` có `conversation_id` ghi thêm tin vào hội thoại | `SocialApiWebhookEvent` | HMAC-SHA256 `sha256=<hex>` của `<timestamp>.<thân thô>`, lệch ≤ 300 s, secret webhook mã hoá ở DB | phía SocialAPI khi nhận 5xx (route trả 500 cho lỗi CSDL/bất ngờ) |
| sự kiện khác                                                             | 200 `ignored`                                                                  | —                       | như trên                                                                                          | —                                                                |

## 8. Server Action

Server Action (`'use server'`) là POST nội bộ của Next.js (header `Next-Action`, id do trình biên dịch sinh), **không** là API công khai, nên không nằm trong OpenAPI. Chung cho mọi action: chống CSRF bởi `proxy.ts` (403 cross-site) cùng kiểm Origin của Next.js; đầu vào là `FormData`/đối số, dịch vụ validate; lỗi nghiệp vụ đã biết → thông điệp trong state của form, lỗi khác ném cho biên lỗi của trang. `requireWorkspace` = đăng nhập (không thì chuyển `/login`) + là thành viên workspace (không thì `notFound`, không lộ workspace tồn tại); quyền chi tiết kiểm ở dịch vụ, không tin form.

| Tệp                                                     | Action                     | Xác thực / quyền                                           | Lũy đẳng                                                              |
| ------------------------------------------------------- | -------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `app/app/actions.ts`                                    | `createWorkspaceAction`    | `requireUser`                                              | không (mỗi lần tạo một workspace)                                     |
| `app/app/account/actions.ts`                            | `deleteAccountAction`      | `requireUser`; id từ phiên; nhập lại mật khẩu + ô xác nhận | lần hai không còn phiên → chuyển `/login`                             |
| `app/app/[workspaceId]/actions.ts`                      | `setAiCloudAction`         | `requireWorkspace`; chỉ owner (dịch vụ)                    | đặt giá trị (ghi đè)                                                  |
| `app/app/[workspaceId]/actions.ts`                      | `setRetentionAction`       | `requireWorkspace`; chỉ owner (dịch vụ)                    | đặt giá trị (ghi đè)                                                  |
| `app/app/[workspaceId]/connections/actions.ts`          | `addConnectionAction`      | `requireWorkspace`; quyền ở dịch vụ                        | theo dịch vụ                                                          |
| `app/app/[workspaceId]/connections/actions.ts`          | `addAccountAction`         | `requireWorkspace`; quyền ở dịch vụ                        | theo dịch vụ                                                          |
| `app/app/[workspaceId]/connections/actions.ts`          | `setWebhookSecretAction`   | `requireWorkspace`; quyền ở dịch vụ                        | đặt giá trị (ghi đè)                                                  |
| `app/app/[workspaceId]/connections/actions.ts`          | `clearWebhookSecretAction` | `requireWorkspace`; quyền ở dịch vụ                        | có: không tìm thấy coi như xong                                       |
| `app/app/[workspaceId]/connections/actions.ts`          | `removeConnectionAction`   | `requireWorkspace`; quyền ở dịch vụ                        | có: không tìm thấy coi như xong                                       |
| `app/app/[workspaceId]/connections/actions.ts`          | `removeAccountAction`      | `requireWorkspace`; quyền ở dịch vụ                        | có: không tìm thấy coi như xong                                       |
| `app/app/[workspaceId]/conversations/actions.ts`        | `saveDraftAction`          | `requireWorkspace`; quyền ở dịch vụ                        | khoá lạc quan theo `baseVersion` (sửa trên bản cũ → xung đột)         |
| `app/app/[workspaceId]/conversations/actions.ts`        | `discardDraftAction`       | `requireWorkspace`; quyền ở dịch vụ                        | theo trạng thái nháp (dịch vụ)                                        |
| `app/app/[workspaceId]/conversations/actions.ts`        | `requestSendAction`        | `requireWorkspace`; quyền `inbox.reply`                    | có: `idempotencyKey` (§5)                                             |
| `app/app/[workspaceId]/conversations/actions.ts`        | `cancelActionAction`       | `requireWorkspace`; quyền ở dịch vụ                        | theo trạng thái hành động (dịch vụ)                                   |
| `app/app/[workspaceId]/conversations/actions.ts`        | `resolveUnknownAction`     | `requireWorkspace`; quyền ở dịch vụ                        | theo trạng thái hành động (dịch vụ)                                   |
| `app/app/[workspaceId]/documents/actions.ts`            | `importDocumentAction`     | `requireWorkspace`; quyền ở dịch vụ                        | có: theo (tiêu đề, nội dung) → báo "đã có"                            |
| `app/app/[workspaceId]/documents/actions.ts`            | `createProjectAction`      | `requireWorkspace`; quyền ở dịch vụ                        | theo dịch vụ                                                          |
| `app/app/[workspaceId]/documents/actions.ts`            | `addAliasAction`           | `requireWorkspace`; quyền ở dịch vụ                        | theo dịch vụ                                                          |
| `app/app/[workspaceId]/documents/actions.ts`            | `removeAliasAction`        | `requireWorkspace`; quyền ở dịch vụ                        | theo dịch vụ                                                          |
| `app/app/[workspaceId]/inbox/actions.ts`                | `syncAccountAction`        | `requireWorkspace`; quyền ở dịch vụ                        | có: chèn theo khoá duy nhất, lần sau báo 0 tin mới                    |
| `app/app/[workspaceId]/inbox/actions.ts`                | `setStatusAction`          | `requireWorkspace`; quyền ở dịch vụ                        | có: đặt giá trị; trạng thái lạ bị bỏ qua; không tìm thấy coi như xong |
| `app/app/[workspaceId]/posts/actions.ts`                | `createPostAction`         | `requireWorkspace`; quyền `posts.publish`                  | có: `idempotencyKey` (§5)                                             |
| `app/app/[workspaceId]/projects/[projectId]/actions.ts` | `addAliasAction`           | `requireWorkspace`; quyền ở dịch vụ                        | theo dịch vụ                                                          |
| `app/app/[workspaceId]/projects/[projectId]/actions.ts` | `removeAliasAction`        | `requireWorkspace`; quyền ở dịch vụ                        | theo dịch vụ                                                          |
| `app/app/[workspaceId]/projects/[projectId]/actions.ts` | `recordDecisionAction`     | `requireWorkspace`; quyền ở dịch vụ                        | không (mỗi lần một quyết định; có thể thay quyết định cũ)             |
| `app/app/[workspaceId]/search/actions.ts`               | `askAction`                | `requireWorkspace`; kết quả lọc theo quyền (dịch vụ)       | chỉ đọc                                                               |

## 9. Kiểm & bằng chứng

- Contract test: `npx vitest run tests/config/api-contract.test.ts` — so `docs/openapi.yaml` với `app/**/route.ts` hai chiều, mã trạng thái literal trong handler, khung YAML (không tab, khoá trùng, thụt lề, `$ref` trỏ được), `operationId` duy nhất, `security` khai từng thao tác, tham số path khai đủ, cơ sở major, bảng Server Action trên khớp `'use server'` thật.
- Chưa có (§10): linter OpenAPI (`spectral lint`/`redocly lint`) và `oasdiff breaking` trong CI.

## 10. Còn thiếu so với blueprint

- `BE-API-001`/`STD-API-001`: chưa có linter OpenAPI trong CI; Kiểm của `STD-API-001` grep `openapi.yaml` ở gốc repo trong khi tệp ở `docs/openapi.yaml`.
- `STD-API-008`/`QA-INT-007`/`STD-PROC-003`: chưa có job `oasdiff breaking` so base/head; test cơ sở ở §6 chỉ phủ mức thao tác + mã trạng thái.
- Rate limit cho route ngoài Better Auth (webhook, export) không có trong mã.

## Thay đổi hợp đồng

| Phiên bản | Ngày       | Thay đổi                                       | Tương thích ngược? | Duyệt bởi |
| --------- | ---------- | ---------------------------------------------- | ------------------ | --------- |
| 1.0.0     | 2026-11-24 | tạo, mô tả hành vi hiện có của 6 route handler | —                  |           |
