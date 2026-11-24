---
status: accepted
implementation-status: done
date: 2026-11-23
decision-makers: phiên chính (AGENTS.md §5, D-024)
consulted: docs/adr/0001-stack.md, docs/adr/0002-x-workspace-direction.md, docs/ARCHITECTURE.md
informed: không
---

# ADR-0007: Một khối triển khai (modular monolith) với ranh giới module do test giữ

## Bối cảnh và vấn đề

X-Workspace là ứng dụng tự host cho nhóm nhỏ (PROJECT.md §1): một người biết chạy Docker Compose vận hành. Cần chốt kiểu kiến trúc để các đợt sau (hộp thư, đăng bài, nguồn dữ liệu cắm được, trợ lý có bộ nhớ) không phình thành đống phụ thuộc chéo, nhưng không đẩy chi phí vận hành lên người dùng cuối. Dự án chưa có công cụ kiểm ranh giới (dependency-cruiser, import-linter) và không muốn thêm phụ thuộc dev chỉ cho việc này.

## Yếu tố quyết định

- Vận hành đơn giản nhất có thể: một image ứng dụng + một Postgres.
- Giao dịch chung dữ liệu và job (ADR-0001); sổ hành động và xoá dữ liệu cần nhất quán mạnh.
- Ranh giới module phải bị máy bắt khi vi phạm, không dựa vào kỷ luật nhớ.

## Các phương án đã cân nhắc

1. **Modular monolith, một deployable** — thư mục `src/<miền>/` có ranh giới kiểm bằng test; `app/` chỉ là lớp HTTP/giao diện mỏng.
2. **Tách dịch vụ ngay** (web, worker, connector) — cô lập tải/lỗi, nhưng thêm triển khai, hàng đợi liên dịch vụ và giao dịch phân tán cho một nhóm 2–10 người; chưa có số đo tải để biện minh.
3. **Một khối không ranh giới** (route gọi thẳng DB) — nhanh lúc đầu, nhưng không chống được vòng phụ thuộc và rò khoá/quyền giữa miền.

## Quyết định

Chọn phương án 1.

- **Một đơn vị triển khai ứng dụng**: một `Dockerfile`, một service `build:` trong `docker-compose.yml` (cạnh `db`). Worker nền chạy trong cùng tiến trình, tách được bằng `RUN_WORKERS=false` (RUNBOOK) mà không đổi mã.
- **Ranh giới do `tests/config/architecture.test.ts` giữ** (thay dependency-cruiser/import-linter, không thêm phụ thuộc):
  - không import `next`/`react` trong `src/` ngoài `src/server/` và `src/auth/client.ts` (điểm nối khung);
  - `pg`, `pg-boss`, `better-auth` chỉ ở các thư mục hạ tầng đã khai (`src/db`, `src/jobs`, `src/server`, `src/auth`);
  - các tệp "lõi thuần" khai trong test (chính sách gửi tin, quyền, mã lỗi, bộ che log, bảo mật…) không import ORM/DB/khung/mạng;
  - `src/` không import `app/`; không vòng import ở mức tệp; ngoài module, chỉ import tệp ở cấp một hoặc `index.ts` (không chui vào thư mục con nội bộ).
- **Tên thư mục cấp một của `src/` là danh sách miền** ở `docs/architecture/domains.md`; thêm thư mục mà không khai miền thì test đỏ.
- **Cấu hình từ biến môi trường** (`src/config/env.ts`); không COPY `.env` vào image; không chuỗi kết nối/khoá trong mã.

### Chấp nhận có chủ ý

Các service nhận một `Db` (Drizzle) và dùng toán tử `drizzle-orm` trực tiếp: **lõi nghiệp vụ không thuần về ORM**. Tách lớp repository sẽ nhân đôi mã cho một nhóm nhỏ và làm yếu giao dịch chung; bù lại, phần quyết định (chính sách, quyền) là hàm thuần có test riêng. Đọc lại khi có ≥ 2 adapter CSDL.

## Điều kiện đọc lại

Đọc lại quyết định này khi **một** điều kiện đúng:

- đo được một module cần co giãn riêng (ví dụ worker nền chiếm > 50% CPU hoặc cần > 1 bản sao độc lập với web);
- có ≥ 2 đội sửa cùng codebase và va chạm triển khai hằng tuần;
- một miền cần cách ly sự cố/bảo mật (khoá nhà cung cấp, dữ liệu theo vùng pháp lý) mà tiến trình chung không đảm bảo.

## Bằng chứng tách

Hiện **không có** dịch vụ tách thêm nào, nên chưa có bằng chứng tách. Khi tách một deployable mới, ADR của nó phải có mục "Bằng chứng tách" nêu số đo (tải/đội/cách ly); `tests/config/architecture.test.ts` đỏ khi số service `build:` trong compose khác 1 mà không có ADR trỏ tới.

## Hệ quả

- Tích cực: một nơi triển khai và sao lưu; giao dịch chung dữ liệu + job; ranh giới có máy canh, thêm miền mới có đường đi rõ.
- Đánh đổi: ORM nằm trong service (xem "Chấp nhận có chủ ý"); kiểm ranh giới bằng test tự viết thay công cụ chuyên dụng — phạm vi hẹp hơn (chỉ import tĩnh dạng `from "…"`).
- Việc tiếp theo: nếu số module tăng mạnh, cân nhắc dependency-cruiser (ADR mới, thêm phụ thuộc dev).
