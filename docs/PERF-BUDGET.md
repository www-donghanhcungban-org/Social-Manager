# Ngân sách hiệu năng web

Nguồn máy đọc: [`perf-budget.json`](../perf-budget.json). Kiểm: `node scripts/check-bundle.mjs` sau `npm run build`; CI chạy bước này sau `gate-par` và **đỏ khi vượt** (FE-PERF-004, XC-PERF-003). Công cụ tự viết thay `size-limit` để không thêm phụ thuộc dev (D-026); hàm `violations` có test cổng ở `tests/config/render-perf.test.ts` (thêm 200 kB thì đỏ).

## Ngưỡng và lý do

Đo ngày 2026-11-24 trên bản build `next build` (Turbopack), gzip, ở `.next/static`. Ngưỡng = số đo hiện tại cộng khoảng 20–25 % để dự án phát triển được, nhưng không cho phình lặng lẽ.

| Mục                | Số đo hiện tại | Ngưỡng | Lý do                                                                  |
| ------------------ | -------------- | ------ | ---------------------------------------------------------------------- |
| `js-total`         | 211,3 kB       | 260 kB | Tổng JS client của mọi route; ứng dụng chủ yếu là server component.    |
| `js-largest-chunk` | 73,4 kB        | 90 kB  | Chunk dùng chung (khung React/Next); tăng đột biến thường do thư viện. |
| `css-total`        | 5,0 kB         | 10 kB  | Tailwind chỉ sinh lớp đã dùng; token một nguồn ở `app/globals.css`.    |

Đổi ngưỡng: sửa `perf-budget.json` **cùng** bảng này trong một PR, nêu lý do và số đo mới ở mô tả PR (không nới ngưỡng để làm cổng xanh).

## Chỉ số hiệu năng và cách báo cáo

- Chỉ số chính, mục tiêu số và điều kiện đo: `PROJECT.md` §Hiệu năng.
- Độ trễ máy chủ báo bằng **phân vị** p50/p95/p99 kèm số mẫu: histogram `http_server_request_duration_seconds` ở `/api/metrics` (`src/observability/metrics.ts`); mục tiêu và cảnh báo viết theo p95, không dùng trung bình làm ngưỡng duy nhất (XC-PERF-004).

## Chưa có (nợ, xem PLAN-harden T-526)

- Lighthouse CI trên PR (FE-PERF-002, FE-PERF-009): cần phụ thuộc dev và Chromium trên CI; chưa thêm.
- Ngân sách kích thước image container, số job CI (XC-GREEN-002), baseline trọng lượng trang và số request (XC-GREEN-001).
