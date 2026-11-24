# Chế độ render theo route (FE-RENDER-001, PRF-WEB-001)

Mọi route nằm đúng **một** chế độ. Quyết định chung: [ADR-0008](adr/0008-render-strategy.md). `tests/config/render-perf.test.ts` so bảng này với cây `app/` (thiếu hay thừa một route = đỏ).

Chế độ: **động** = render theo từng request, không cache dùng chung; **tĩnh** = dựng lúc build; **API** = route handler không render giao diện.

Mọi phản hồi động đi qua `proxy.ts`, nơi đặt `Cache-Control: private, no-store` và CSP có nonce theo request (nên không thể dựng tĩnh các trang có script — D-006).

| Route                                               | Chế độ | Lý do                                                     |
| --------------------------------------------------- | ------ | --------------------------------------------------------- |
| `/`                                                 | động   | Chuyển hướng theo phiên đăng nhập; đọc cookie.            |
| `/login`                                            | động   | Có nonce CSP theo request và trạng thái phiên.            |
| `/app`                                              | động   | Danh sách workspace của người dùng hiện tại.              |
| `/app/[workspaceId]`                                | động   | Dữ liệu theo workspace và quyền của người dùng.           |
| `/app/[workspaceId]/connections`                    | động   | Kết nối và tài khoản theo workspace.                      |
| `/app/[workspaceId]/conversations`                  | động   | Hội thoại theo workspace.                                 |
| `/app/[workspaceId]/conversations/[conversationId]` | động   | Hội thoại, nháp và hành động gửi theo workspace.          |
| `/app/[workspaceId]/documents`                      | động   | Tài liệu và bí danh theo workspace.                       |
| `/app/[workspaceId]/inbox`                          | động   | Hộp thư hợp nhất theo workspace.                          |
| `/app/[workspaceId]/posts`                          | động   | Bài đăng và trạng thái theo workspace.                    |
| `/app/[workspaceId]/projects/[projectId]`           | động   | Trang dự án theo workspace.                               |
| `/app/[workspaceId]/search`                         | động   | Tìm kiếm và hỏi đáp, kết quả lọc theo quyền.              |
| `/api/auth/[...all]`                                | API    | Better Auth; theo phiên và cookie.                        |
| `/api/health`                                       | API    | Kiểm tra sẵn sàng (có DB), `no-store`.                    |
| `/api/health/live`                                  | API    | Kiểm tra sống, không DB, `no-store`.                      |
| `/api/metrics`                                      | API    | Prometheus; 404 khi chưa đặt `METRICS_TOKEN`, `no-store`. |
| `/api/webhooks/socialapi/[connectionId]`            | API    | Webhook ký HMAC, không cache.                             |

Không có route tĩnh hay cache dùng chung (ISR, `use cache`): dữ liệu của người dùng không bao giờ vào cache chia sẻ. Khi cần trang tĩnh công khai (giới thiệu, tài liệu), thêm dòng `tĩnh` kèm lý do ở đây và đổi ADR-0008.
