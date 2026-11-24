# DPIA — X-Workspace (trợ lý công việc, hộp thư hợp nhất) · phiên bản 1 · 2026-11-24

> Bản làm việc nội bộ theo mẫu `.xtemplates/framework/templates/DPIA.md`. Số Điều lấy từ nguồn thứ cấp (xem `PROJECT.md` mục Khung pháp lý, tra 2026-11-24), **chưa đối chiếu bản gốc**; biểu mẫu nộp cơ quan nhà nước (mẫu kèm NĐ 356/2025) do chủ dự án điền và ký, agent không nộp thay.

| Trường                         | Giá trị                                                                                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vai trò của tổ chức            | Bên kiểm soát dữ liệu của người dùng (email, tên, phiên). Với tin nhắn của khách nhắn tin: chủ workspace là bên kiểm soát, X-Workspace là hệ thống xử lý do chủ workspace tự host. Chủ dự án chốt vai trò pháp lý chính xác (chưa xác minh) |
| Thông tin liên hệ tổ chức      | (chủ dự án điền: pháp nhân, địa chỉ, người đại diện)                                                                                                                                                                                        |
| Người phụ trách bảo vệ dữ liệu | (chủ dự án chỉ định)                                                                                                                                                                                                                        |
| Căn cứ lập                     | Luật 91/2025/QH15 Đ.21–22 và NĐ 356/2025/NĐ-CP (số Điều chưa xác minh với bản gốc)                                                                                                                                                          |
| Trạng thái nộp                 | **chưa nộp** — việc của chủ dự án, hạn 60 ngày kể từ ngày bắt đầu xử lý dữ liệu thật (chưa đối chiếu bản gốc). Hiện chưa có dữ liệu thật (`OUTBOUND_LIVE=false`, chưa có người dùng ngoài)                                                  |
| Lần cập nhật kế tiếp           | 2027-05-24 (6 tháng); cập nhật sớm khi đổi mục đích, đổi nhà cung cấp hoặc bật AI đám mây                                                                                                                                                   |

## 1. Mô tả hoạt động xử lý

| Mục đích                        | Loại dữ liệu                                            | Chủ thể                                      | Nguồn                       | Căn cứ                                                                                                     |
| ------------------------------- | ------------------------------------------------------- | -------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Đăng nhập, phân quyền workspace | email, tên, băm mật khẩu Argon2id, phiên (IP, thiết bị) | người dùng có tài khoản                      | tự nhập                     | hợp đồng (cung cấp dịch vụ)                                                                                |
| Hộp thư hợp nhất, tìm kiếm      | tên, mã người dùng, nội dung tin của khách nhắn tin     | khách của chủ workspace (không có tài khoản) | SocialAPI, GitHub, nhập tay | lợi ích hợp pháp của chủ workspace trả lời khách; chủ workspace chịu trách nhiệm thông báo (chưa xác minh) |
| Hỏi đáp AI trên tin và tài liệu | trích đoạn đã che PII (`src/ai/redact.ts`)              | như trên                                     | trong workspace             | **đồng ý** của chủ workspace, ghi ở bảng `consents`, mặc định tắt                                          |
| Nhật ký kiểm toán               | mã người dùng, hành động, thời điểm                     | người dùng                                   | hệ thống                    | nghĩa vụ bảo đảm an toàn hệ thống                                                                          |

Không chủ động thu dữ liệu nhạy cảm; nội dung tin tự do có thể vô tình chứa → coi là dữ liệu cá nhân, che trước khi gửi AI, câu hỏi nhạy cảm chuyển người (`src/ai/guard.ts`). Không có trẻ em là chủ thể chủ đích.

## 2. Luồng dữ liệu

```text
[Khách] --nhắn--> [SocialAPI / GitHub] --webhook, nhập--> [X-Workspace tự host: Next.js + Postgres + kho blob]
[Chủ workspace] --đăng nhập--> [X-Workspace]
[X-Workspace] --trích đoạn đã che PII, chỉ khi owner đồng ý và máy chủ cấu hình AI_BASE_URL--> [Dịch vụ AI]
[X-Workspace] --gửi tin trả lời (OUTBOUND_LIVE=true và workspace bật)--> [SocialAPI] --> [Khách]
```

## 3. Bên nhận và chuyển xuyên biên giới

Chi tiết từng luồng ở `docs/privacy/transfers.md` và `docs/privacy/processors.md`; danh mục máy đọc ở `docs/compliance/vendors.yaml`.

| Bên nhận                        | Vai trò       | Dữ liệu                              | Mục đích        | Quốc gia                                           | Hợp đồng/DPA                        |
| ------------------------------- | ------------- | ------------------------------------ | --------------- | -------------------------------------------------- | ----------------------------------- |
| SocialAPI (`api.social-api.ai`) | bên xử lý     | tin nhắn và hồ sơ khách, tin trả lời | kênh nhắn tin   | (chưa xác minh)                                    | (chưa có, chủ dự án xin)            |
| Dịch vụ AI do máy chủ cấu hình  | bên xử lý     | trích đoạn đã che PII                | trả lời câu hỏi | tuỳ điểm cuối; cục bộ (Ollama/vLLM) không ra ngoài | (chưa có; chỉ cần khi dùng đám mây) |
| GitHub (`api.github.com`)       | nguồn dữ liệu | nội dung issue/PR của repo pilot     | nhập vào kho    | (chưa xác minh)                                    | điều khoản GitHub                   |

## 4. Đồng ý và quyền chủ thể

- Đồng ý AI đám mây: một nút cấp/rút ở trang workspace, bản ghi chỉ thêm (`consents`), rút xong cổng AI chặn ngay (`tests/retention/rights.test.ts`, `e2e/rights.spec.ts`).
- Truy cập/xuất: `/app/account` (JSON của chính mình); xoá tài khoản: nhập lại mật khẩu, lan mọi kho kể cả tệp blob. Hạn theo NĐ 356 Đ.5 (10/15/20 ngày): thao tác tự phục vụ có hiệu lực tức thì, nhanh hơn mọi mốc.
- Khách không có tài khoản: chưa có hàng chờ yêu cầu (CMP-VN-007, `loop defer` ở T-529); chủ workspace dùng công cụ xoá owner (`ErasureService`).

## 5. Thời hạn lưu và xoá

Bảng đầy đủ ở `docs/compliance/data-inventory.csv` (đối chiếu hai chiều với migration bằng `tests/config/data-classification.test.ts`). Tin: 365 ngày mặc định, owner đổi 1–36500 ngày, job `maintenance.purge-expired` 03:17 UTC hằng ngày.

## 6. Biện pháp bảo vệ

| Biện pháp                | Mô tả                                              | Bằng chứng                            |
| ------------------------ | -------------------------------------------------- | ------------------------------------- |
| Mã hoá khi truyền        | HSTS, https bắt buộc cho SocialAPI                 | `tests/security`, `src/config/env.ts` |
| Mã hoá khi lưu           | khoá nhà cung cấp mã hoá trong DB                  | `tests/providers`                     |
| Kiểm soát truy cập       | quyền kiểm ở server theo vai trò, cô lập workspace | `tests/auth`, `tests/security`        |
| Nhật ký kiểm toán        | `audit_events` chỉ thêm, có trigger chặn sửa/xoá   | `tests/db`                            |
| Sao lưu, xoá đúng hạn    | RUNBOOK §Backup; job purge                         | `docs/RUNBOOK.md`, `tests/retention`  |
| Sự cố, thông báo vi phạm | `docs/ops/runbooks/data-breach.md` (72 giờ)        | `tests/config/repo-docs.test.ts`      |

## 7. Rủi ro và giảm thiểu

| ID    | Rủi ro cho chủ thể                                  | Khả năng                         | Nghiêm trọng | Biện pháp                                                       | Còn lại    | Trạng thái      |
| ----- | --------------------------------------------------- | -------------------------------- | ------------ | --------------------------------------------------------------- | ---------- | --------------- |
| DP-01 | lộ tin nhắn của khách do truy cập trái phép         | thấp                             | cao          | cô lập workspace ở server, THREAT-MODEL                         | thấp       | đã giảm         |
| DP-02 | gửi dữ liệu khách tới dịch vụ AI ngoài ý muốn       | thấp                             | cao          | mặc định tắt, đồng ý riêng, che PII, cổng chặn khi không đồng ý | thấp       | đã giảm         |
| DP-03 | dữ liệu còn lại sau khi xoá (tệp blob mồ côi)       | trung bình                       | trung bình   | `releaseFiles` dọn tệp, test xoá lan                            | thấp       | đã sửa ở T-529  |
| DP-04 | không đáp ứng hạn yêu cầu của khách không tài khoản | trung bình                       | trung bình   | công cụ owner; hàng chờ DSAR còn treo                           | trung bình | mở (CMP-VN-007) |
| DP-05 | luồng ra nước ngoài chưa có hồ sơ nộp               | cao khi bật SocialAPI/AI đám mây | trung bình   | `docs/privacy/transfers.md`, chủ dự án nộp                      | trung bình | mở (CMP-VN-004) |

## 8. Tự đánh giá tuân thủ

| Yêu cầu                                             | Đạt / Chưa / N/A                                                                             | Bằng chứng                       |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------- |
| Thông báo xử lý cho chủ thể trước khi xử lý         | một phần (người dùng thấy văn bản đồng ý; khách chưa có kênh thông báo, thuộc chủ workspace) | `src/workspaces/consent.ts`      |
| Đồng ý hợp lệ cho từng mục đích                     | Đạt (mục đích duy nhất cần đồng ý: AI đám mây)                                               | `tests/retention/rights.test.ts` |
| Hợp đồng với bên xử lý có điều khoản bảo vệ dữ liệu | Chưa                                                                                         | `docs/privacy/processors.md`     |
| Hồ sơ nộp đúng hạn, cập nhật đúng nhịp              | Chưa nộp (chưa có dữ liệu thật)                                                              | mục trạng thái ở đầu file        |
| Chuyển ra nước ngoài có hồ sơ riêng                 | Chưa nộp, đã soạn danh mục                                                                   | `docs/privacy/transfers.md`      |

## 10. Ký

| Vai trò            | Tên         | Ngày |
| ------------------ | ----------- | ---- |
| Người lập          | (chủ dự án) |      |
| Đại diện pháp nhân | (chủ dự án) |      |

## Lịch sử cập nhật

| Phiên bản | Ngày       | Lý do           | Đã nộp? |
| --------- | ---------- | --------------- | ------- |
| 1         | 2026-11-24 | bản đầu (T-530) | chưa    |
