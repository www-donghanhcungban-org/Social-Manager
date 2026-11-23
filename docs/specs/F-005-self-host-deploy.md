# F-005 — Triển khai tự host bằng Docker Compose

Trạng thái: đã triển khai, image chưa build thật trong môi trường phát triển (không có Docker; xem `docs/RISKS.md` RK-006). Yêu cầu: R-006.

## Tiêu chí chấp nhận

- Given máy có Docker, When chạy `docker compose up`, Then CSDL và ứng dụng khởi động, migration chạy lũy đẳng trước khi nhận yêu cầu.
- Container ứng dụng chạy bằng người dùng không phải root; không bí mật trong image hay trong `docker-compose.yml`.
- Thiếu biến môi trường bắt buộc → ứng dụng từ chối khởi động và nói rõ thiếu biến nào (không in giá trị).
- Có `/api/health` cho kiểm tra sống; sao lưu và khôi phục theo `docs/RUNBOOK.md`.

## Ca biên

- Chạy migration hai lần; CSDL chưa sẵn sàng lúc ứng dụng khởi động.

## Kiểm

- `tests/config/deploy.test.ts`, `tests/config/env.test.ts`, `tests/config/startup.test.ts`, `tests/config/runbook.test.ts`
