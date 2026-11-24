---
status: accepted
implementation-status: done
date: 2026-11-24
decision-makers: phiên chính (AGENTS.md §5, D-027)
consulted: docs/adr/0001-stack.md, docs/adr/0007-modular-monolith.md, docs/ROUTES.md
informed: không
---

# ADR-0008: Mọi route giao diện render động, không cache dùng chung

## Bối cảnh và vấn đề

Ứng dụng là công cụ làm việc đăng nhập: gần như mọi trang hiển thị dữ liệu của một workspace theo quyền người xem. CSP dùng nonce theo từng request (D-006), nên vỏ tĩnh không mang được nonce. Cần chốt chiến lược render theo nhóm route để không có đường nào đưa dữ liệu người dùng vào cache chia sẻ.

## Yếu tố quyết định

- Đúng và an toàn: dữ liệu của người dùng A không bao giờ trả cho người dùng B qua cache.
- Giữ nonce CSP theo request (`script-src` không `unsafe-inline`).
- Quy mô nhỏ (nhóm 2–10 người): hiệu năng render động đủ; chưa có số đo cần cache.

## Các phương án đã cân nhắc

1. **Render động cho mọi route giao diện** (không `cacheComponents`, không ISR, không `use cache`) — đơn giản, không rò cache, giữ được nonce.
2. **Cache Components / PPR cho vỏ trang** — nhanh hơn ở byte đầu, nhưng vỏ tĩnh không có nonce theo request nên phải nới CSP; thêm bề mặt rò dữ liệu nếu cache nhầm phần có dữ liệu người dùng.
3. **ISR cho trang công khai** — chưa có trang công khai nào cần; thêm khi có.

## Quyết định

Chọn phương án 1. Phản hồi động đi qua `proxy.ts` đặt `Cache-Control: private, no-store`. Route API không cache (`no-store`). Bảng từng route: `docs/ROUTES.md` (test so với cây `app/`). Không đọc cookie/header/`Date.now()`/random trong hàm cache vì không có hàm cache nào (`tests/config/render-perf.test.ts` cấm `use cache`, `unstable_cache`, `cacheComponents`, `revalidate` cố định).

## Hệ quả

- Tốt: không thể rò dữ liệu qua cache dùng chung; CSP chặt giữ nguyên.
- Đánh đổi: mỗi lần xem tốn một lần render và truy vấn DB; chấp nhận ở quy mô hiện tại. Khi số đo (p95 render, `docs/PERF-BUDGET.md`) cho thấy cần, thêm cache theo ADR mới kèm khoá cache chứa workspace và quyền.

## Điều kiện đọc lại

Có trang công khai cần SEO/tĩnh; p95 render của một route vượt mục tiêu ở `PROJECT.md` §Hiệu năng; CSP đổi sang băm thay nonce.
