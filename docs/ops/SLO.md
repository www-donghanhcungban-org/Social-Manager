# SLO — X-Workspace (OPS-SLO-001)

Dịch vụ hướng người dùng: ứng dụng web (`app`). Nguồn số đo: `/api/metrics` (Prometheus text, Bearer), histogram `http_server_request_duration_seconds` với nhãn `method`, `route`, `status` (`src/observability/metrics.ts`). Cửa sổ đánh giá: 28 ngày trượt. Chưa có Prometheus/Grafana dựng sẵn (RUNBOOK §0): truy vấn dưới đây là **định nghĩa**; chạy được khi người triển khai gắn Prometheus vào `/api/metrics`.

## SLI availability

Tỉ lệ yêu cầu tốt = yêu cầu không phải lỗi máy chủ (không 5xx) trên tổng yêu cầu, **loại** `/api/health*` và `/api/metrics` (giám sát tự gọi) và 4xx (lỗi của người gọi).

```promql
sum(rate(http_server_request_duration_seconds_count{route!~"/api/health.*|/api/metrics",status!~"5.."}[5m]))
/
sum(rate(http_server_request_duration_seconds_count{route!~"/api/health.*|/api/metrics"}[5m]))
```

**Mục tiêu:** ≥ 99,5% trong 28 ngày (ngân sách lỗi 0,5% ≈ 3 giờ 22 phút). Cảnh báo đốt nhanh: tỉ lệ lỗi 5xx > 5% trong 5 phút liên tục.

## SLI latency

Tỉ lệ yêu cầu nhanh = yêu cầu hoàn thành trong 0,8 giây trên tổng (khớp ngân sách `p95 ≤ 800 ms` ở `PROJECT.md` mục Hiệu năng; 0,8 phải là một cận `le` của histogram).

```promql
sum(rate(http_server_request_duration_seconds_bucket{route!~"/api/health.*|/api/metrics",le="0.8"}[5m]))
/
sum(rate(http_server_request_duration_seconds_count{route!~"/api/health.*|/api/metrics"}[5m]))
```

**Mục tiêu:** ≥ 95% trong 28 ngày.

## Ghi chú

- Ngưỡng lùi sau deploy dùng cùng số đo: RUNBOOK §Smoke test.
- Máy chủ đơn lẻ (một `app`, một `db`) nên SLO này là **mục tiêu nội bộ**, không phải cam kết với khách. Chưa có số đo thật (chưa chạy thật); ghi baseline sau tuần đầu.
- Kiểm tự động: `tests/config/runbook.test.ts` đòi cả hai truy vấn dùng tên metric có thật trong mã và cận `0.8` có trong `BUCKETS` của `src/observability/metrics.ts`.
