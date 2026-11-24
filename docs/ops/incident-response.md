# Runbook: Xử lý sự cố (Incident Response)

> **Theo ADR-0004: repo khung KHÔNG kèm sẵn scaffold Web.** Mọi tên công nghệ/file cụ thể trong tài liệu này
> (Next.js, Supabase, Vercel, `lighthouse-ci.yml`, `lib/env.ts`…) là **ví dụ cho hồ sơ Web (C1)** — dự án đích tự tạo
> khi hồ sơ áp dụng là Web; hồ sơ khác thay bằng công cụ tương đương (`quality-gates-by-profile.md`).

> Cụ thể hóa "Quy trình xử lý sự cố rõ ràng" của KHUNG 1 (GĐ 8 — Sau ra mắt).
> Mục tiêu: khi production có sự cố, **giảm thiệt hại trước, tìm nguyên nhân sau** — theo các bước cố định
> để không phải suy nghĩ lúc đang hoảng.

## X-Workspace: SEV1–SEV4, thứ tự xử lý, sự cố bảo mật (OPS-IR-001/004/010)

Phần này là bản của dự án và **thắng** mọi chỗ khác trong tệp khi mâu thuẫn. Người được tuyên bố sự cố: chủ dự án hoặc người trực; ai phát hiện thì báo người đó ngay. Kênh liên lạc: ghi ở RUNBOOK §0 khi chạy thật (chưa có kênh trực — việc chủ dự án).

| Mức      | Nghĩa                              | Ví dụ của X-Workspace                                                                                                                      | Phản hồi                    |
| -------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| **SEV1** | Sập, mất hoặc lộ dữ liệu, mất khoá | `/api/health` 503 kéo dài, `db` mất volume; tin nhắn của khách lộ sang workspace khác; khoá nhà cung cấp hoặc `BETTER_AUTH_SECRET` lộ      | ngay, mọi lúc               |
| **SEV2** | Suy giảm nặng, luồng chính hỏng    | worker nền không lên (bài hẹn giờ, đồng bộ đứng); bài `failed` hàng loạt vì khoá nhà cung cấp hết hạn; tìm kiếm hay hỏi đáp AI lỗi toàn bộ | trong 4 giờ làm việc        |
| **SEV3** | Ảnh hưởng nhỏ, có cách lách        | bài `send_unknown` cần đối soát tay; nhiều 429 ở đăng nhập do proxy chưa đặt `CLIENT_IP_HEADER`; một workspace không xuất được dữ liệu     | trong ngày làm việc kế tiếp |
| **SEV4** | Phiền toái, không ảnh hưởng dùng   | nhãn tiếng Việt sai chính tả; cảnh báo log lặp không mất dữ liệu; tài liệu runbook sai một lệnh                                            | xếp vào đợt sửa kế          |

Sự cố bảo mật (lộ dữ liệu hoặc bí mật, xâm nhập, truy cập trái phép) **luôn là SEV1**, bất kể quy mô.

### Thứ tự cố định

phát hiện → phân mức → **giảm thiệt hại** (rollback, tắt cờ `OUTBOUND_LIVE` hoặc `ai_cloud_enabled`, khôi phục từ sao lưu, khoá workspace) → liên lạc → khắc phục triệt để qua cổng thường (nhánh `fix/…`, CI, PR) → đóng → post-mortem. Dòng thời gian của sự cố phải có mốc "giảm thiệt hại" **trước** mốc "nguyên nhân gốc" (`incidents/` theo mẫu POST-MORTEM).

### Nhánh "sự cố bảo mật" (SEV1 thêm các việc sau, làm song song với giảm thiệt hại)

- [ ] **Bảo toàn chứng cứ**: không xoá log, không chạy `purge`/dọn dẹp, chụp `audit_events` và log `app` quanh thời điểm (`docker compose logs --since …`), giữ CSDL bị ảnh hưởng (đổi tên, xem `runbooks/restore-database.md` §B bước 2).
- [ ] **Thu hồi, xoay bí mật** theo RUNBOOK §Xoay bí mật/Lộ bí mật: phiên (đổi `BETTER_AUTH_SECRET`), khoá nhà cung cấp, `POSTGRES_PASSWORD`, token GitHub.
- [ ] **Đánh giá nghĩa vụ thông báo**: dữ liệu cá nhân nào, của ai → làm theo [`runbooks/data-breach.md`](runbooks/data-breach.md) (đồng hồ 72 giờ, Mẫu 08). Phạm vi địa lý chỉ Việt Nam (D-031).
- [ ] **Liên lạc**: chủ workspace bị ảnh hưởng; báo theo `SECURITY.md` nếu lỗ hổng cần công bố.
- [ ] **Post-mortem** trong 5 ngày làm việc, hành động thành issue có người phụ trách và hạn.

## Phân mức nghiêm trọng (severity) — bản chung của khung

| Mức      | Nghĩa                      | Ví dụ                               | Phản hồi                   |
| -------- | -------------------------- | ----------------------------------- | -------------------------- |
| **SEV1** | Sập/mất dữ liệu/lộ dữ liệu | site down, rò rỉ dữ liệu, mất tiền  | Xử lý ngay, mọi lúc        |
| **SEV2** | Suy giảm nặng              | luồng chính lỗi, chậm nghiêm trọng  | Trong giờ làm, ưu tiên cao |
| **SEV3** | Ảnh hưởng nhỏ              | lỗi ngoài luồng chính, có cách lách | Lên lịch xử lý             |

## Các bước (theo thứ tự)

1. **Phát hiện & ghi nhận.** Mở một issue sự cố (template `incident`); ghi thời điểm bắt đầu, triệu chứng,
   ai đang xử lý. Nguồn cảnh báo: Sentry, uptime monitor, người dùng báo.
2. **Đánh giá mức (severity)** theo bảng trên. SEV1 → ưu tiên tuyệt đối.
3. **Giảm thiệt hại trước (mitigate).** Ưu tiên khôi phục dịch vụ hơn là vá triệt để:
   - **Rollback** bản deploy gần nhất theo nền tảng của dự án (vd Vercel: Promote bản trước; container: tag ảnh trước; mobile/blockchain KHÔNG rollback được — xem bảng "Rollback theo hồ sơ" trong `docs/framework/quality-gates-by-profile.md`), HOẶC
   - Tắt cờ tính năng/feature flag gây lỗi, HOẶC
   - Khôi phục dữ liệu từ **backup/PITR** (nếu mất/hỏng dữ liệu).
4. **Liên lạc.** Cập nhật trạng thái cho người dùng nếu ảnh hưởng diện rộng (trang status/thông báo).
5. **Khắc phục triệt để.** Sửa nguyên nhân gốc theo đúng quy trình: nhánh `fix/...` → cổng commit/merge → deploy.
6. **Đóng sự cố.** Xác nhận đã hết triệu chứng; ghi thời điểm kết thúc.
7. **Viết post-mortem** (dùng **Mẫu post-mortem** ở cuối file này) cho mọi SEV1/SEV2 — **không đổ lỗi cá nhân**,
   tập trung vào hệ thống. Mọi hành động khắc phục → tạo issue có người phụ trách + hạn.

## Nguyên tắc

- **An toàn trước tốc độ:** thao tác lên dữ liệu thật phải cân nhắc rollback trước khi chạy.
- **Một người điều phối (incident lead)** ngay cả khi làm nhóm nhỏ — tránh giẫm chân nhau.
- **Mọi thay đổi lúc chữa cháy vẫn ghi lại** để post-mortem tái dựng được dòng thời gian.
- Mỗi sự cố để lại **ít nhất một cải tiến** (test hồi quy, cảnh báo mới, hàng rào mới) để không lặp lại.

---

# Mẫu post-mortem

> Sao chép **mục này** cho mỗi sự cố SEV1/SEV2 thành `docs/ops/postmortem-YYYY-MM-DD-<slug>.md`.
> **Văn hóa không đổ lỗi (blameless):** mục tiêu là cải thiện hệ thống, không phán xét con người.

- **Ngày sự cố:**
- **Mức (severity):** SEV1 / SEV2 / SEV3
- **Thời lượng:** từ ____ đến ____ (tổng: ____)
- **Người điều phối:**
- **Trạng thái:** Đang điều tra / Đã khắc phục / Đã đóng

## Tóm tắt

<!-- 2–3 câu: chuyện gì xảy ra, ảnh hưởng ai, đã giải quyết thế nào. -->

## Ảnh hưởng

- Người dùng bị ảnh hưởng (số lượng/tỷ lệ):
- Chức năng bị ảnh hưởng:
- Dữ liệu/tiền bị ảnh hưởng (nếu có):

## Dòng thời gian (UTC)

| Thời điểm | Sự kiện                                        |
| --------- | ---------------------------------------------- |
|           | Bắt đầu (nguyên nhân được đưa vào / kích hoạt) |
|           | Phát hiện (cảnh báo/báo cáo đầu tiên)          |
|           | Bắt đầu giảm thiệt hại                         |
|           | Khôi phục dịch vụ                              |
|           | Đóng sự cố                                     |

## Nguyên nhân gốc

<!-- Phân tích "5 Whys": vì sao xảy ra? vì sao không bị chặn sớm hơn?
     Vì sao các hàng rào (test/CI/cảnh báo) không bắt được? -->

## Cái gì đã chạy tốt / chưa tốt

- **Tốt:**
- **Chưa tốt:**
- **May mắn (suýt tệ hơn):**

## Hành động khắc phục (mỗi mục → issue có người phụ trách + hạn)

| Hành động | Loại (vá / phòng ngừa / phát hiện) | Người phụ trách | Hạn | Issue |
| --------- | ---------------------------------- | --------------- | --- | ----- |
|           |                                    |                 |     |       |

> Quy tắc: mỗi sự cố để lại **ít nhất một hàng rào mới** (test hồi quy, cảnh báo, kiểm tra CI)
> để cùng nguyên nhân không tái diễn.
