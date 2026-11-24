<!-- Mẫu nâng phiên bản MAJOR (OPS-MAINT-005). Dùng: mở PR với `?template=major-upgrade.md`; gắn nhãn `major`. PR riêng, không gộp với tính năng. -->

## Mục tiêu

<!-- Gói và phiên bản: từ → đến. Vì sao nâng (hỗ trợ, bảo mật, tính năng cần). -->

## Changelog và hướng dẫn nâng cấp đã đọc

<!-- Dán link changelog/migration guide và tóm tắt thay đổi phá vỡ ảnh hưởng tới dự án (3–7 dòng). Codemod chính thức: có/không, đã chạy chưa. -->

## Bằng chứng

- [ ] Toàn bộ test + E2E xanh ở head — link run:
- [ ] Gói không thêm telemetry mặc định / license mới ngoài `license-policy.json` — kiểm bằng:

## Rủi ro và đường lùi

<!-- Cách triển khai an toàn (canary/cờ tính năng) và cách quay lại (revert PR, lockfile cũ, migration lùi). -->

## Phụ thuộc mới

<!-- Mỗi gói mới (kể cả transitive đáng chú ý): `tên · phiên bản ghim · giấy phép · lý do · phương án thay thế đã xét`; không có thì ghi "không có". -->

## Docs

- [ ] Docs cập nhật / không cần (lý do):
