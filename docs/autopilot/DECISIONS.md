# Nhật ký quyết định tự duyệt

> Ghi bởi `xt.py loop decide`. Phiên chính tự duyệt điểm quyết định theo tiêu chí chất lượng cuối (`LOOP-STOP-018`, ADR-0008 của khung). Người xem lại bất cứ lúc nào; đổi ý → quyết định mới ghi "thay D-NNN", không sửa mục cũ. Chủ dự án quyết đề xuất "Khi chạy thật" bằng `xt.py loop decide-prod` (mục mới), không đổi nhãn dòng cũ.

### D-001 · 2026-11-22T01:59:53+00:00 · Duyệt PLAN đợt 0: 6 task (cổng sàn M, hợp đồng provider, client SocialAPI, kho khoá, schema, đăng nhập)

- Phương án: (1) Duyệt như viết, làm tuần tự theo sau: · (2) Thêm UI trong đợt 0
- Chọn: Duyệt như viết, làm tuần tự theo sau:
- Lý do (tiêu chí chất lượng cuối): Nền đúng và an toàn trước (tiêu chí 1), có đường lùi, UI để đợt 1 khi đã có hợp đồng provider
- Đường lùi: Sửa PLAN.md rồi chạy lại loop init

### D-002 · 2026-11-22T02:09:57+00:00 · T-006 gộp phân quyền và đăng nhập quá lớn cho một task ≤ 1 ngày: tách thế nào?

- Phương án: (1) Giữ một task T-006 · (2) Tách T-006 (quy tắc vai trò/thành viên ở server, test trên DB) và T-007 (nối Better Auth + route)
- Chọn: Tách T-006 (quy tắc vai trò/thành viên ở server, test trên DB) và T-007 (nối Better Auth + route)
- Lý do (tiêu chí chất lượng cuối): Quy tắc phân quyền là phần quyết định tính đúng và an toàn nên cần test sâu riêng; nối thư viện đăng nhập là phần phụ thuộc bên ngoài, rủi ro khác, Gate khác
- Đường lùi: Gộp lại hai dòng task trong PLAN.md

### D-003 · 2026-11-22T02:21:28+00:00 · Vòng lặp đòi xử lý MUST của blueprint: bắt đầu từ đâu?

- Phương án: (1) Theo thứ tự blueprint, gom các mục cùng chủ đề thành task nhỏ có Gate · (2) Bỏ qua blueprint, làm đợt 1 tính năng trước
- Chọn: Theo thứ tự blueprint, gom các mục cùng chủ đề thành task nhỏ có Gate
- Lý do (tiêu chí chất lượng cuối): Cấu hình + bí mật là nền cho mọi đợt sau (đúng và an toàn trước); gom BASE-CFG-001..008 vào một task kiểm được bằng test
- Đường lùi: Đổi task T-008 thành [~] Bỏ trong PLAN.md

### D-004 · 2026-11-22T02:22:30+00:00 · Quy tắc quyền chặn ghi .env.example (deny rule), cần làm gì với BASE-CFG-003?

- Phương án: (1) Tách thành task riêng chờ người tạo, không tìm đường khác để ghi file · (2) Tạo file tương đương tên khác (env.example) để lách
- Chọn: Tách thành task riêng chờ người tạo, không tìm đường khác để ghi file
- Lý do (tiêu chí chất lượng cuối): Bị chặn là kết luận (AGENTS.md §4): lách bằng tên khác cho cùng hiệu ứng là vượt quyền; nội dung file đã sẵn để người lưu
- Đường lùi: Người cấp quyền ghi .env.example rồi chạy lại task T-009

### D-005 · 2026-11-22T02:40:20+00:00 · Đăng ký tài khoản: mở và tự đăng nhập, hay không tự đăng nhập để không lộ email đã có (review 🟠 6)?

- Phương án: (1) Mở, autoSignIn bật (UX nhanh, lộ email đã đăng ký) · (2) autoSignIn tắt: đăng ký email mới và email có sẵn cho cùng phản hồi
- Chọn: autoSignIn tắt: đăng ký email mới và email có sẵn cho cùng phản hồi
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1 (đúng và an toàn): không cho dò email đã đăng ký, không cần hạ tầng email. Xác minh email và chế độ chỉ-mời sẽ cân nhắc ở đợt 1 khi có UI.
- Đường lùi: Bật lại autoSignIn trong src/auth/auth.ts và đổi hai test trong tests/auth-integration/auth.test.ts

### D-006 · 2026-11-22T03:50:50+00:00 · CSP script-src có nonce hay cho phép unsafe-inline để giữ Cache Components/PPR?

- Phương án: (1) Tắt Cache Components, render động mọi route, CSP nonce + strict-dynamic · (2) Giữ Cache Components, script-src 'self' 'unsafe-inline' · (3) Giữ Cache Components, CSP bằng hash/SRI thử nghiệm
- Chọn: Tắt Cache Components, render động mọi route, CSP nonce + strict-dynamic
- Lý do (tiêu chí chất lượng cuối): Đúng và an toàn thắng: vỏ tĩnh không mang được nonce theo request (đã đo: chrome chặn 11 script, form không hydrate); ứng dụng toàn trang theo người dùng nên mất PPR gần như không thiệt; MUST PRF-WEB-007 cấm unsafe-inline
- Đường lùi: Bật lại cacheComponents + partialPrefetching trong next.config.ts, bỏ headers() ở app/layout.tsx, đổi CSP sang phương án 2 hoặc 3 và ghi D mới

### D-007 · 2026-11-22T04:02:55+00:00 · Thư viện Argon2id cho mật khẩu (BE-AUTH-001)?

- Phương án: (1) hash-wasm 4.13.0 (WASM thuần, MIT, ghim đúng) · (2) @node-rs/argon2 2.2.2 (binary native theo nền tảng) · (3) giữ scrypt mặc định của Better Auth
- Chọn: hash-wasm 4.13.0 (WASM thuần, MIT, ghim đúng)
- Lý do (tiêu chí chất lượng cuối): Blueprint đòi Argon2id; WASM thuần chạy mọi nền tảng/Docker không cần binary prebuilt nên bền và dễ tự host; scrypt chỉ được khi không có Argon2id; chấp nhận chậm hơn native vài chục ms
- Đường lùi: Bỏ password.hash/verify trong auth.ts (về scrypt) — hash cũ khác định dạng nên người dùng phải đặt lại mật khẩu

### D-008 · 2026-11-22T05:08:29+00:00 · Thêm @axe-core/playwright 4.14.0 (devDependency) để kiểm a11y tự động (UX-A11Y-001)?

- Phương án: (1) Thêm @axe-core/playwright (MPL-2.0, peer playwright-core, bản 2026-11-19) · (2) Chỉ kiểm tay/grep, không có máy kiểm a11y
- Chọn: Thêm @axe-core/playwright (MPL-2.0, peer playwright-core, bản 2026-11-19)
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1 đúng và an toàn: máy kiểm a11y đáng tin hơn grep; chỉ devDependency, không vào bản chạy; giấy phép MPL-2.0 tương thích dùng nội bộ
- Đường lùi: Gỡ devDependency và e2e/a11y.spec.ts

### D-009 · 2026-11-22T07:17:24+00:00 · Tiếp quản công cụ quy trình X-Templates thành của dự án: dời đường dẫn hay giữ tại chỗ?

- Phương án: (1) Giữ .xtemplates/, bỏ quản lý bản cài, gỡ di sản, may đo tài liệu · (2) Dời sang tools/xt/ và docs/process/, sửa nhận diện gốc trong xt.py và guard
- Chọn: Giữ .xtemplates/, bỏ quản lý bản cài, gỡ di sản, may đo tài liệu
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1: guard nhận diện dự án đích và bảo vệ hàng rào theo đường dẫn .xtemplates/; dời mà sót một chỗ là mất bảo vệ. Mục tiêu thực chất (thôi là bản cài bên ngoài quản lý, không còn tệp chết) đạt được với rủi ro thấp; ADR-0003
- Đường lùi: git revert commit tiếp quản hoặc cài lại khung bằng install.py

### D-010 · 2026-11-22T07:17:25+00:00 · Thời hạn lưu tin nhắn của khách khi chuyển sang X-Working (bản gốc muốn giữ lâu dài)

- Phương án: (1) Cấu hình theo workspace, mặc định 365 ngày, cho phép giữ vô thời hạn khi chủ workspace bật · (2) Giữ vô thời hạn mặc định cho mọi dữ liệu · (3) Giữ cố định 365 ngày như hiện tại
- Chọn: Cấu hình theo workspace, mặc định 365 ngày, cho phép giữ vô thời hạn khi chủ workspace bật
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1: tin của khách là dữ liệu cá nhân bên thứ ba, Luật 91/2025 Điều 3 chỉ cho lưu trong thời gian cần cho mục đích; mặc định chặt, giữ lâu là lựa chọn có chủ đích của chủ workspace (đáp ứng mục 7 bản gốc)
- Đường lùi: Đặt lại cột retention về NULL (dùng mặc định) hoặc revert migration 0006

### D-011 · 2026-11-22T07:18:32+00:00 · Duyệt PLAN-xw-1: 7 task (tiếp quản công cụ, hợp đồng hội thoại/tin nhắn, schema, đồng bộ, webhook, trạng thái bài đăng, thời hạn lưu) + 2 task chờ người

- Phương án: (1) Duyệt như viết, làm tuần tự theo sau: · (2) Bắt đầu bằng AI/tìm kiếm để có giá trị sớm
- Chọn: Duyệt như viết, làm tuần tự theo sau:
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1: AI dựng trên dữ liệu sai định danh và trạng thái không trung thực sẽ sai theo; thứ tự dữ liệu → tri thức/AI → hành động giữ đúng mục 15.8 bản gốc
- Đường lùi: Sửa PLAN-xw-1.md rồi chạy lại loop init

### D-012 · 2026-11-22T07:33:10+00:00 · Tên sản phẩm/repo sau khi chủ dự án đổi repo Social-Manager thành X-Workspace

- Phương án: (1) X-Workspace cho cả sản phẩm, repo, package, log service; giữ nguyên bản ghi lịch sử (docx gốc, ADR-0001, nhật ký quyết định, PLAN đợt 0) kèm ghi chú · (2) Giữ tên sản phẩm X-Working, chỉ đổi repo/package
- Chọn: X-Workspace cho cả sản phẩm, repo, package, log service; giữ nguyên bản ghi lịch sử (docx gốc, ADR-0001, nhật ký quyết định, PLAN đợt 0) kèm ghi chú
- Lý do (tiêu chí chất lượng cuối): Chủ dự án chọn qua câu hỏi trong phiên; một tên thống nhất tránh lệch giữa repo, giao diện và tài liệu; bản ghi lịch sử không viết lại (ADR append-only)
- Đường lùi: Một commit đổi tên riêng: git revert commit đó; GitHub vẫn chuyển hướng URL cũ

### D-013 · 2026-11-22T15:39:58+00:00 · Phạm vi và thứ tự đợt xw-2 (kho bằng chứng) của X-Workspace

- Phương án: (1) Kho bản gốc theo hash trước, rồi dự án/liên kết, dòng thời gian/bao phủ/xoá-xuất, connector GitHub bằng cổng fetch tiêm được; tài liệu nhập là văn bản/Markdown, PDF-Docling để đợt sau · (2) Làm đủ PDF/Docling và connector GitHub thật ngay trong xw-2
- Chọn: Kho bản gốc theo hash trước, rồi dự án/liên kết, dòng thời gian/bao phủ/xoá-xuất, connector GitHub bằng cổng fetch tiêm được; tài liệu nhập là văn bản/Markdown, PDF-Docling để đợt sau
- Lý do (tiêu chí chất lượng cuối): Đúng và an toàn trước: lớp dẫn xuất (tri thức, AI) chỉ đáng tin khi bằng chứng gốc có hash và xoá xuyên lớp được. Docling cần runtime Python riêng và quota tài nguyên; token GitHub thật là khoá chỉ chủ dự án có (mặc định tự host, kiểm bằng fixture, token thật defer T-209)
- Đường lùi: PLAN-xw-2 chỉ là tài liệu; mỗi task một commit có migration down, revert theo commit

### D-014 · 2026-11-22T23:33:09+00:00 · Phạm vi lớp AI và tìm kiếm của đợt xw-3

- Phương án: (1) Tìm kiếm toàn văn dựng sẵn của Postgres trên văn bản đã bỏ dấu bằng hàm riêng; cổng ModelPort với adapter OpenAI-tương-thích bằng fetch, AI tắt mặc định, đám mây bật theo workspace kèm nhật ký; bộ 50 câu đo truy xuất; chưa thêm phụ thuộc AI SDK và pg_trgm · (2) Thêm AI SDK 7 và extension pg_trgm ngay trong xw-3
- Chọn: Tìm kiếm toàn văn dựng sẵn của Postgres trên văn bản đã bỏ dấu bằng hàm riêng; cổng ModelPort với adapter OpenAI-tương-thích bằng fetch, AI tắt mặc định, đám mây bật theo workspace kèm nhật ký; bộ 50 câu đo truy xuất; chưa thêm phụ thuộc AI SDK và pg_trgm
- Lý do (tiêu chí chất lượng cuối): Đúng và an toàn trước: bộ truy xuất đúng và kiểm được trên PGlite trong Gate; dữ liệu khách không rời máy khi chưa được phép (H6). Không thêm phụ thuộc/extension khi chưa có phép thử và khoảng thiếu cụ thể (working.md §2 H7, source-plan mục 14). Cổng ModelPort giữ đường nâng AI SDK sau
- Đường lùi: Mỗi task một commit có migration down; ModelPort tách adapter nên đổi adapter không chạm dịch vụ
