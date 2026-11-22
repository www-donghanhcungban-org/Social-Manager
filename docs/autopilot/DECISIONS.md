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
