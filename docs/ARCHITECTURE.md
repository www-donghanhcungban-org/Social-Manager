# Kiến trúc X-Workspace (C4 mức 1–2)

Quyết định kiểu kiến trúc: [ADR-0007](adr/0007-modular-monolith.md) (một khối triển khai). Miền và thư mục: [architecture/domains.md](architecture/domains.md). Cập nhật: 2026-11-23.

## Mức 1 — Bối cảnh hệ thống

```mermaid
C4Context
  title X-Workspace — bối cảnh
  Person(member, "Thành viên workspace", "Owner/thành viên: trả lời tin, đăng bài, tra cứu bằng chứng")
  System(xw, "X-Workspace", "Ứng dụng tự host: hộp thư hợp nhất, đăng bài, bằng chứng dự án, trợ lý có bộ nhớ")
  System_Ext(social, "SocialAPI", "Nhà cung cấp kênh mạng xã hội (tin nhắn, đăng bài, webhook)")
  System_Ext(github, "GitHub", "Nguồn bằng chứng (issue/PR/review) qua token người gọi cấp")
  System_Ext(ai, "Mô hình AI (tuỳ chọn)", "Điểm cuối tương thích OpenAI; tắt mặc định, đám mây cần owner bật")
  Rel(member, xw, "Dùng qua trình duyệt", "HTTPS")
  Rel(xw, social, "Gọi API gửi/đồng bộ", "HTTPS, khoá mã hoá trong CSDL")
  Rel(social, xw, "Webhook ký HMAC", "HTTPS")
  Rel(xw, github, "Đọc bằng chứng", "HTTPS, token chỉ đọc")
  Rel(xw, ai, "Trích đoạn có nhật ký trước khi gửi", "HTTPS")
```

## Mức 2 — Container

```mermaid
C4Container
  title X-Workspace — container
  Person(member, "Thành viên")
  Container_Boundary(deploy, "Một đơn vị triển khai: image app (Docker Compose)") {
    Container(web, "Giao diện + HTTP", "Next.js 16 App Router, React 19", "app/: trang, Server Actions, route API (health, auth, webhook)")
    Container(core, "Lõi miền", "TypeScript (src/)", "Dịch vụ theo miền: workspaces, auth, inbox, posts, actions, evidence, knowledge, retention…")
    Container(worker, "Worker nền", "pg-boss, cùng tiến trình (RUN_WORKERS)", "Đồng bộ, đăng hẹn giờ, gỡ hành động kẹt, dọn dữ liệu")
  }
  ContainerDb(db, "PostgreSQL 16", "Drizzle + migration có đường lùi", "Dữ liệu, hàng đợi pgboss, sổ hành động")
  ContainerDb(blob, "Volume blobdata", "Hệ tệp", "Bản gốc bằng chứng theo băm (ADR-0004)")
  System_Ext(social, "SocialAPI")
  System_Ext(github, "GitHub")
  System_Ext(ai, "Mô hình AI")
  Rel(member, web, "HTTPS")
  Rel(web, core, "Gọi hàm (cùng tiến trình)")
  Rel(worker, core, "Gọi hàm")
  Rel(core, db, "SQL", "pg")
  Rel(core, blob, "Đọc/ghi tệp")
  Rel(core, social, "HTTPS")
  Rel(core, github, "HTTPS")
  Rel(core, ai, "HTTPS qua cổng AI (ADR-0005)")
```

## Điểm cuối công khai (BE-API-009)

Route handler trong `app/api/` là **danh sách công khai đã duyệt**; mọi route khác phải xác thực ở server. Test `tests/security/web-security.test.ts` so khớp thư mục với bảng này.

| Route                                    | Cách xác thực                                                         |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `/api/auth/*`                            | Better Auth (đăng ký/đăng nhập; giới hạn tần suất; CSRF qua proxy)    |
| `/api/health`                            | công khai, chỉ đọc, không dữ liệu người dùng (`{status}` ok/degraded) |
| `/api/webhooks/socialapi/[connectionId]` | chữ ký HMAC-SHA256 trên thân thô + timestamp; secret theo kết nối     |

Trang và Server Action của `/app/*` luôn qua `requireUser`/`requireWorkspace` (`src/server/runtime.ts`).

## Quy tắc ranh giới (kiểm bằng test)

`tests/config/architecture.test.ts` giữ: `src/` không import `next`/`react` ngoài `src/server/` và `src/auth/client.ts`; hạ tầng (`pg`, `pg-boss`, `better-auth`) chỉ ở thư mục đã khai; tệp lõi thuần không import ORM/khung/mạng; không import `app/` từ `src/`; không vòng import; ngoài module chỉ import tệp cấp một hoặc `index.ts`. Chi tiết và đánh đổi: ADR-0007.
