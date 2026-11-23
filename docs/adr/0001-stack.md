---
status: accepted
implementation-status: not-started
date: 2026-11-22
decision-makers: phiên chính (tự duyệt theo AGENTS.md §5, ủy quyền của chủ dự án)
consulted: chủ dự án (chọn web tự host, nhiều nguồn dữ liệu, nhiều người dùng)
informed: không
---

# ADR-0001: Next.js + Postgres + Drizzle + pg-boss + Better Auth làm stack

## Bối cảnh và vấn đề

Social Manager là web app tự host: hộp thư hợp nhất, đăng bài, tự động trả lời bằng AI, thống kê, nhiều người dùng,
nguồn dữ liệu cắm được (`src/providers/`). Tự động hoá phải chạy 24/7 trên server, webhook phải về thẳng server,
khoá của nhà cung cấp phải nằm phía server. Repo đã là scaffold Next.js 16 + React 19 + Tailwind 4 + Vitest.

## Yếu tố quyết định

- Ít thành phần vận hành nhất (tự host bằng một `docker compose`): một cơ sở dữ liệu, không thêm Redis.
- Type-safe từ DB tới UI; dữ liệu ngoài (webhook, API nhà cung cấp, form) validate lúc chạy.
- Hàng đợi bền cho tự động hoá, retry, lịch đăng; idempotency theo webhook delivery.
- Giữ nguyên cái repo đã có (Next.js, Vitest, Tailwind).

## Các phương án đã cân nhắc

1. **Postgres + Drizzle + pg-boss + Better Auth + Zod** (một DB cho dữ liệu, hàng đợi và phiên đăng nhập).
2. Postgres + Prisma + BullMQ (Redis) + Auth.js.
3. Giữ `localStorage` + app desktop như bản tham chiếu (không có server) — loại: không chạy khi tắt máy, một người dùng.

## Quyết định

Chọn **phương án 1**, vì chỉ cần một dịch vụ phụ (Postgres) cho cả dữ liệu, hàng đợi và đăng nhập, giữ `docker compose` tối giản
và giảm điểm hỏng khi tự host.

Phiên bản đã xác minh bằng `npm view <gói> version`, 2026-11-22:

| Gói                       | Phiên bản        | Ghi chú                                          |
| ------------------------- | ---------------- | ------------------------------------------------ |
| next                      | 16.4.6           | đang dùng                                        |
| react / react-dom         | 19.3.1           | đang dùng                                        |
| drizzle-orm / drizzle-kit | 0.45.4 / 0.31.11 | dưới 1.0: ghim chính xác, đọc changelog khi nâng |
| pg                        | 8.23.1           | driver Postgres                                  |
| pg-boss                   | 12.39.0          | hàng đợi trên Postgres                           |
| better-auth               | 1.7.27           | đăng nhập, phiên, vai trò                        |
| zod                       | 4.6.7            | validate dữ liệu ngoài                           |
| @tanstack/react-query     | 5.108.2          | chỉ thêm khi UI cần cache phía client            |

Đang dùng bản cũ hơn bản mới nhất, **cố ý giữ** tới khi có PR `/upgrade` riêng: vitest 4.1.12 (mới nhất 5.1.1),
typescript ^5 (mới nhất 7.0.2).

### Hệ quả

- Tốt: một DB; hàng đợi có transaction chung với dữ liệu nghiệp vụ; không cần Redis.
- Đánh đổi: pg-boss chạy trên Postgres nên thông lượng job thấp hơn Redis, đủ cho quy mô một workspace nhỏ; Drizzle chưa 1.0.
- Việc phải làm: cài gói từng PR (không cài trước khi có code dùng); schema + migration có đường lùi; kho khoá mã hoá (ADR riêng).

### Xác nhận

`rg -n '"(drizzle-orm|pg|pg-boss|better-auth|zod)"' package.json` ra đủ gói khi đợt 0 xong; `implementation-status` cập nhật theo PR.

## Hệ quả

Đánh đổi và việc phải làm nằm ở mục Quyết định phía trên (một dịch vụ phụ, thông lượng job thấp hơn Redis, cài gói từng PR). Mục này thêm ở T-518 chỉ để đủ trường theo mẫu (ARC-ADR-003); nội dung quyết định không đổi.

## Ưu / nhược từng phương án

### Phương án 1

- Tốt: một dịch vụ phụ; transaction chung dữ liệu + job; ít cấu hình.
- Xấu: pg-boss/Better Auth/Drizzle ít phổ biến hơn bộ ở phương án 2 (chưa đo; không xác minh được trong lượt này).

### Phương án 2

- Tốt: hệ sinh thái lớn hơn.
- Xấu: thêm Redis để vận hành và sao lưu; hai nơi giữ trạng thái.
