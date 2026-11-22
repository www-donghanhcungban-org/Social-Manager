---
status: accepted
implementation-status: in-progress
date: 2026-11-22
decision-makers: chủ dự án (tên sản phẩm, phạm vi, ba giai đoạn — kế hoạch sản phẩm 2026-11-22); phiên chính (hiệu chỉnh kỹ thuật theo AGENTS.md §5)
consulted: nghiên cứu nguồn sống 2026-11-22 (docs/research/2026-11-22-x-workspace-research.md)
informed: không
---

# ADR-0002: Phát triển Social Manager thành X-Workspace, giữ một codebase

> Tên sản phẩm: bản kế hoạch gốc gọi là X-Working; chủ dự án đổi repo và tên sản phẩm thành X-Workspace ngày 2026-11-22 (D-012).

## Bối cảnh và vấn đề

Chủ dự án chốt kế hoạch sản phẩm X-Workspace (`docs/work/2026-11-22-x-workspace-plan/source-plan.md`): trợ lý công việc
có bộ nhớ dài hạn, gom tin nhắn, repo, tài liệu và ngữ cảnh ứng dụng vào hồ sơ dự án, trả lời có bằng chứng, soạn và
thực hiện công việc trong phạm vi được cấp. Social Manager (ADR-0001) trở thành nền và module hội thoại. Nghiên cứu bổ
sung cho thấy nền hiện tại có ba chỗ sai ngữ nghĩa phải sửa trước khi xây tri thức và AI lên trên.

## Yếu tố quyết định

- Đúng và an toàn trước (AGENTS.md §5): không dựng AI trên dữ liệu sai định danh hay trạng thái không trung thực.
- Ít thành phần vận hành: giữ một Postgres, một hàng đợi pg-boss, một ứng dụng Next.js (ADR-0001).
- Dữ liệu độc lập với model và công cụ thu thập; mọi lớp dẫn xuất dựng lại được từ bản gốc.
- Tuân thủ Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15 cho dữ liệu của khách (bên thứ ba).

## Các phương án đã cân nhắc

1. **Mở rộng codebase hiện tại theo module** (`evidence`, `conversations`, `knowledge`, `search`, `ai`, `actions`,
   `devices`, connector GitHub) + tiến trình Companion riêng trên Windows.
2. Dựng dịch vụ mới (agent framework, vector DB, graph DB, workflow engine) bên cạnh nền Social Manager.
3. Dùng dịch vụ bộ nhớ có sẵn (Mem0, Letta, Hindsight) làm lõi.

## Quyết định

Chọn phương án 1, theo đúng mục 16 của kế hoạch sản phẩm, kèm các hiệu chỉnh kỹ thuật H1–H14 ở
`docs/work/2026-11-22-x-workspace-plan/working.md` §2. Các điểm ràng buộc:

- Hội thoại và tin nhắn là hai thực thể; khoá khử trùng tin là `(tài khoản, platform_id)` của nền tảng (H1).
- Trạng thái nhận từ nhà cung cấp được lưu đúng nghĩa: `publishing` không phải `published` (H2).
- Mọi gửi ra ngoài đi qua sổ hành động; mất phản hồi sau khi gửi là `send_unknown`, không tự gửi lại (H3, H14).
- Thời hạn lưu tin của khách cấu hình được theo workspace; xoá theo yêu cầu đi xuyên mọi lớp dẫn xuất (H5).
- Gửi dữ liệu cho AI cloud mặc định tắt; điểm cuối AI tương thích OpenAI do người dùng cấu hình (H6, H7).
- Tìm kiếm bắt đầu bằng Postgres (bỏ dấu tiếng Việt + `pg_trgm`); vector chỉ khi bộ đánh giá chứng minh lợi ích (H8).
- Companion gọi `agent-desktop` qua CLI với danh sách lệnh cho phép, không qua MCP (H9).

## Lý do

Phương án 2 và 3 thêm thành phần vận hành và chỗ giữ dữ liệu thứ hai trước khi có số đo cho thấy cần; phương án 3 còn
lưu "facts" trích xuất thay cho bản gốc (Hindsight Retain), trái nguyên tắc bản gốc là nguồn sự thật. Phương án 1 dùng
lại xác thực, phân quyền workspace, hàng đợi, CSP/CSRF và cổng kiểm thử đã có.

## Hệ quả

- Tích cực: mỗi lát đi qua cùng cổng (Vitest trên PGlite, Playwright trên Postgres thật) và cùng mô hình quyền.
- Đánh đổi: Postgres gánh cả tìm kiếm ở giai đoạn đầu; nếu bộ 50 câu cho thấy thiếu, thêm `pgvector` trong cùng
  Postgres (ADR mới).
- Đổi tên repository/package chỉ làm khi chủ dự án yêu cầu, cùng thay đổi remote, CI, secrets (mục 16 bản gốc).
- Việc cần chủ dự án: khoá SocialAPI và kênh thử, máy Windows thử, token GitHub chỉ đọc cho repo pilot.
