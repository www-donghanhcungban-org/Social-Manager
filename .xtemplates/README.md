# .xtemplates/ — công cụ quy trình của X-Workspace

Công cụ quy trình **thuộc dự án X-Workspace**, tiếp quản ngày 2026-11-22 (ADR-0003). Tách từ phiên bản v3.35.0 của dự án X-Templates (https://github.com/www-donghanhcungban-org/X-Templates), commit `38698d4`.

- Sửa như mã của dự án: qua PR, cổng (`dev-task.sh gate-fast`, CI) và lý do trong commit khi chạm cổng/hook. Không còn `install.py`/`xt.py upgrade` quản lý; không chạy `install.py` đè lên thư mục này.
- `scripts/` — công cụ chạy được (`xt.py`, `dev-task.sh`, …), cần CPython 3.15.x (`uv python install 3.15`; CI ghim 3.15.2).
- `framework/` — thư viện yêu cầu (ID trong `BLUEPRINT.md`, mẫu tài liệu). `research/` — ghi chép nghiên cứu gốc.
- Tên thư mục `.xtemplates/` được giữ có chủ đích: `xt.py` nhận diện gốc dự án và guard bảo vệ hàng rào theo đúng đường dẫn này (ADR-0003 §Quyết định).
- Lấy bản sửa từ X-Templates: chép tay từng commit qua PR, ghi SHA nguồn trong mô tả commit.
