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

### D-015 · 2026-11-23T01:24:40+00:00 · Phạm vi và an toàn của đợt xw-4 (gửi trả lời từ hộp thư) khi chủ dự án giao toàn quyền tự quyết

- Phương án: (1) Dựng đủ nháp, chính sách, sổ hành động, send_unknown, đối soát, job; kiểm bằng nhà cung cấp giả; gửi thật mặc định TẮT bằng hai cờ (OUTBOUND_LIVE của hệ thống, outbound_enabled do owner bật), tác tử không bật · (2) Bật gửi thật ngay khi xong
- Chọn: Dựng đủ nháp, chính sách, sổ hành động, send_unknown, đối soát, job; kiểm bằng nhà cung cấp giả; gửi thật mặc định TẮT bằng hai cờ (OUTBOUND_LIVE của hệ thống, outbound_enabled do owner bật), tác tử không bật
- Lý do (tiêu chí chất lượng cuối): Đúng và an toàn trước: gửi tin là hành động không đảo ngược tới người thật, SocialAPI không có idempotency; ủy quyền production ghi outbound_messages live=false. Toàn quyền tự quyết áp dụng cho thiết kế và thi công, không thay cho khoá thật và quyết định bật gửi thật của chủ dự án
- Đường lùi: Mỗi task một commit có migration down; cờ OUTBOUND_LIVE tắt là dừng mọi đường gửi

### D-016 · 2026-11-23T03:00:24+00:00 · Đợt tiếp theo sau xw-4: làm gì trong phiên khi chủ dự án giao toàn quyền?

- Phương án: (1) Giao diện hội thoại và trả lời (đọc, nháp, yêu cầu gửi, trạng thái) trên dịch vụ xw-4, gửi thật vẫn tắt · (2) Bắt đầu xw-5 thiết bị Windows
- Chọn: Giao diện hội thoại và trả lời (đọc, nháp, yêu cầu gửi, trạng thái) trên dịch vụ xw-4, gửi thật vẫn tắt
- Lý do (tiêu chí chất lượng cuối): Đúng và an toàn: dịch vụ xw-4 chưa có giao diện nên chưa dùng được; xw-5 cần máy Windows và ghép cặp thiết bị thật, không kiểm được trong phiên. Toàn quyền áp dụng cho thiết kế và thi công, không thay cho khoá thật và quyết định bật gửi thật
- Đường lùi: Mỗi task một commit; giao diện không đổi dữ liệu, gỡ trang là đủ

### D-017 · 2026-11-23T12:32:17+00:00 · Duyệt PLAN-harden-2026-11-23 (pha harden đợt 1): đường nào đưa release-check khỏi NO-GO?

- Phương án: (1) Duyệt PLAN 40 task do Opus soạn: audit full trước, khai lệnh migration_check/rollback/attack/acceptance sớm, rồi 22 nhóm MUST theo tiền tố, chờ người ở T-009/T-108/T-540/T-541/T-542 · (2) Chỉ khai 5 lệnh còn N/A của release-check, hoãn audit và MUST sang đợt sau
- Chọn: Duyệt PLAN 40 task do Opus soạn: audit full trước, khai lệnh migration_check/rollback/attack/acceptance sớm, rồi 22 nhóm MUST theo tiền tố, chờ người ở T-009/T-108/T-540/T-541/T-542
- Lý do (tiêu chí chất lượng cuối): Đúng và an toàn trước: hàng audit và blueprint là BLOCKER nên không thể bỏ; thứ tự chạy đề nghị bỏ BLOCKER rẻ trước. Việc cần quyền hoặc khoá của chủ dự án nằm ngoài đường chính (loop defer). Gửi thật giữ TẮT. Cờ cổng không bị nới.
- Đường lùi: PLAN chỉ là tài liệu; mỗi task một commit/PR, revert theo PR; chưa chạy loop init

### D-018 · 2026-11-23T15:11:12+00:00 · Duyệt kế hoạch sửa sau audit full 2026-11-23: thứ tự đợt và mức các phát hiện

- Phương án: (1) Sửa theo đợt: đường gửi tin trước (AUD-CODE-001, AUD-CODE-002), rồi CI Postgres, tài liệu, xoá/xuất dữ liệu, harness; hạ các lệch tài liệu và cấu hình không có hành vi sai xuống 🟢 nợ có chủ · (2) Giữ mọi 🟠 do cụm DOC/HAR/XFEAT báo và sửa tất cả trước khi làm MUST blueprint
- Chọn: Sửa theo đợt: đường gửi tin trước (AUD-CODE-001, AUD-CODE-002), rồi CI Postgres, tài liệu, xoá/xuất dữ liệu, harness; hạ các lệch tài liệu và cấu hình không có hành vi sai xuống 🟢 nợ có chủ
- Lý do (tiêu chí chất lượng cuối): Đúng và an toàn trước: hai lỗi trên đường gửi tin là hành động ra ngoài không đảo ngược nên sửa đầu tiên với test đỏ trước; các lệch tài liệu không có đường tái hiện dẫn tới hành vi sai nên xử lý theo task PLAN-harden đã có, không nới cổng, không hạ mức để biến mất phát hiện (mọi dòng vẫn giữ trong sổ)
- Đường lùi: Kế hoạch chỉ là tài liệu: sửa AUDIT-STATUS.md và AUDIT-REPORT-2026-11-23.md rồi lập lại thứ tự đợt

### D-019 · 2026-11-23T15:57:39+00:00 · AUD-DATA-001 (xoá/xuất dữ liệu người dùng): sửa trong đợt này hay chấp nhận có hạn?

- Phương án: (1) Làm ngay trong T-503 · (2) Chấp nhận có hạn 2026-12-14, làm trọn ở T-529 cùng data-inventory và quyền chủ thể
- Chọn: Chấp nhận có hạn 2026-12-14, làm trọn ở T-529 cùng data-inventory và quyền chủ thể
- Lý do (tiêu chí chất lượng cuối): Đúng và an toàn: xoá tài khoản cần thiết kế quyền chủ thể đầy đủ (CMP-PRIV-005), làm vội dễ xoá nhầm dữ liệu; đã có task T-529 nhận việc, không phải lỗi hồi quy
- Đường lùi: Không đổi mã; mở lại hàng sổ nếu T-529 trượt hạn

### D-020 · 2026-11-23T21:02:39+00:00 · T-510: 31 MUST của blueprint không áp dụng cho X-Workspace — miễn bằng [~] Không áp dụng hay làm?

- Phương án: (1) Làm đủ 31 mục (tiền, WebSocket, OAuth server, MCP, cache ngoài, analytics, IaC...) dù sản phẩm không có tính năng đó · (2) Đánh [~] Không áp dụng kèm điều kiện kiểm được bằng test (tests/config/baseline-floor.test.ts) đỏ khi sản phẩm thêm đúng thứ bị loại
- Chọn: Đánh [~] Không áp dụng kèm điều kiện kiểm được bằng test (tests/config/baseline-floor.test.ts) đỏ khi sản phẩm thêm đúng thứ bị loại
- Lý do (tiêu chí chất lượng cuối): Đúng và an toàn: làm cho tính năng không tồn tại là code chết, tăng bề mặt tấn công; điều kiện kiểm bằng máy nên miễn trừ không im lặng hết hạn; giữ đường lùi bằng cách bỏ [~] khi thêm tính năng
- Đường lùi: Bỏ [~] và dòng Không áp dụng của mục tương ứng, làm MUST; test điều kiện sẽ đỏ trước

### D-021 · 2026-11-23T21:14:43+00:00 · T-511: LOOP-OPT-* và các mục vướng di sản T-108 xử lý thế nào?

- Phương án: (1) Tick/miễn hết dù chưa có bằng chứng · (2) LOOP-OPT-001/002/003/005 = Không áp dụng có điều kiện kiểm bằng test (chưa có task tối ưu); LOOP-ORCH-001/003, LOOP-STOP-001/002 (harness-check đỏ do di sản T-108) và LOOP-STOP-005 (nhãn risk PR) = loop defer cho người, giữ [ ]
- Chọn: LOOP-OPT-001/002/003/005 = Không áp dụng có điều kiện kiểm bằng test (chưa có task tối ưu); LOOP-ORCH-001/003, LOOP-STOP-001/002 (harness-check đỏ do di sản T-108) và LOOP-STOP-005 (nhãn risk PR) = loop defer cho người, giữ [ ]
- Lý do (tiêu chí chất lượng cuối): Đúng và an toàn: không khai xanh khi harness-check đỏ thật; gỡ cấu hình ask/agent coordinator là hạ hàng rào, guard cấm agent tự làm; OPT chỉ áp khi mở task tối ưu
- Đường lùi: Bỏ [~] của OPT khi thêm perf/trial.json; hết defer khi người gỡ di sản T-108

### D-022 · 2026-11-23T21:57:35+00:00 · T-514: giữ skipLibCheck=true trong tsconfig hay bỏ để đạt FE-BUILD-003/PRF-WEB-002?

- Phương án: (1) Đặt skipLibCheck=false · (2) Giữ skipLibCheck=true: chỉ bỏ qua .d.ts của gói bên thứ ba, mã dự án vẫn strict + noUncheckedIndexedAccess
- Chọn: Giữ skipLibCheck=true: chỉ bỏ qua .d.ts của gói bên thứ ba, mã dự án vẫn strict + noUncheckedIndexedAccess
- Lý do (tiêu chí chất lượng cuối): Đo được: tsc --skipLibCheck false báo lỗi ở 4+ gói bên thứ ba (pglite, drizzle, next) không thuộc dự án và không sửa được; skipLibCheck không che lỗi mã dự án. Đúng và đơn giản; test khoá strict
- Đường lùi: Đặt lại skipLibCheck=false khi gói bên thứ ba sạch kiểu

### D-023 · 2026-11-23T22:08:43+00:00 · T-515: license copyleft yếu (MPL-2.0, LGPL-3.0, CC-BY-4.0) trong cây phụ thuộc — chấp nhận hay thay thế?

- Phương án: (1) Thay thế/loại bỏ các gói đó · (2) Cho phép qua ngoại lệ có hạn 2027-06-30 trong license-policy.json (dùng nguyên bản, không sửa), ghi công ở THIRD_PARTY_NOTICES.md
- Chọn: Cho phép qua ngoại lệ có hạn 2027-06-30 trong license-policy.json (dùng nguyên bản, không sửa), ghi công ở THIRD_PARTY_NOTICES.md
- Lý do (tiêu chí chất lượng cuối): Đo được: 14 gói LGPL là nhị phân native tuỳ chọn của sharp, MPL là lightningcss/axe-core (bộ công cụ build/dev), CC-BY là dữ liệu caniuse; không thay được vì thuộc Next/Tailwind; dùng nguyên bản thì tuân thủ; ngoại lệ có hạn, test đỏ khi hết hạn hoặc thêm gói mới ngoài danh sách
- Đường lùi: Xoá ngoại lệ tương ứng; test license đỏ cho tới khi gỡ gói

### D-024 · 2026-11-23T23:10:25+00:00 · Kiểu kiến trúc và cách kiểm ranh giới module (ADR-0007)

- Phương án: (1) Modular monolith một deployable, ranh giới kiểm bằng test tự viết (không thêm phụ thuộc) · (2) Tách dịch vụ (web/worker/connector) ngay · (3) Thêm dependency-cruiser/import-linter làm công cụ kiểm
- Chọn: Modular monolith một deployable, ranh giới kiểm bằng test tự viết (không thêm phụ thuộc)
- Lý do (tiêu chí chất lượng cuối): Đúng và an toàn: một nơi triển khai/sao lưu, giao dịch chung dữ liệu+job; ranh giới có máy canh mà không thêm phụ thuộc dev chưa xác minh; ORM trong service là đánh đổi chấp nhận có điều kiện đọc lại
- Đường lùi: Viết ADR mới thay ADR-0007: đổi test sang dependency-cruiser hoặc tách deployable kèm mục Bằng chứng tách

### D-025 · 2026-11-23T23:59:46+00:00 · DB-SEC-007: cô lập workspace bằng RLS Postgres hay bằng tầng ứng dụng?

- Phương án: (1) RLS: ENABLE+FORCE trên mọi bảng có workspace_id, policy theo biến phiên SET LOCAL, cần vai trò app không phải owner và mọi truy vấn trong giao dịch · (2) Cô lập tầng ứng dụng: mọi truy vấn lọc workspace_id sau requireAction; test BOLA/BFLA khoá hành vi; DB-SEC-007 Không áp dụng có điều kiện kiểm được
- Chọn: Cô lập tầng ứng dụng: mọi truy vấn lọc workspace_id sau requireAction; test BOLA/BFLA khoá hành vi; DB-SEC-007 Không áp dụng có điều kiện kiểm được
- Lý do (tiêu chí chất lượng cuối): Ứng dụng hiện kết nối bằng một vai trò duy nhất (chủ dự án, DB-SEC-002 chưa tách) nên FORCE RLS không có hiệu lực bảo vệ thật nếu không tách vai trò và bọc mọi truy vấn vào giao dịch SET LOCAL; làm nửa vời tạo cảm giác an toàn giả. Chọn lọc ở tầng dịch vụ có test chéo workspace chạy trong CI; RLS để làm cùng DB-SEC-002 khi triển khai tách vai trò (cần người kiểm trên hạ tầng thật)
- Đường lùi: Thêm migration bật RLS kèm vai trò app riêng; migration .down tắt RLS và thu hồi vai trò

### D-026 · 2026-11-24T01:19:48+00:00 · Công cụ kiểm ngân sách bundle (FE-PERF-004)

- Phương án: (1) Tự viết scripts/check-bundle.mjs đọc perf-budget.json, không thêm phụ thuộc · (2) Thêm size-limit và preset làm phụ thuộc dev
- Chọn: Tự viết scripts/check-bundle.mjs đọc perf-budget.json, không thêm phụ thuộc
- Lý do (tiêu chí chất lượng cuối): Không thêm phụ thuộc dev (chuỗi cung ứng), nhất quán ADR-0007; hàm violations có test cổng; đủ cho 3 mục ngân sách
- Đường lùi: Đổi sang size-limit khi cần đo theo từng route hoặc import cost: giữ perf-budget.json làm nguồn số, thêm .size-limit.json

### D-027 · 2026-11-24T01:19:49+00:00 · Chiến lược render và mục tiêu hiệu năng chính

- Phương án: (1) Mọi route giao diện render động, không cache dùng chung; mục tiêu LCP 2,5 s, p95 máy chủ 800 ms · (2) Cache Components/PPR cho vỏ trang
- Chọn: Mọi route giao diện render động, không cache dùng chung; mục tiêu LCP 2,5 s, p95 máy chủ 800 ms
- Lý do (tiêu chí chất lượng cuối): Đúng và an toàn: dữ liệu người dùng không vào cache chia sẻ; giữ nonce CSP theo request (D-006); chưa có số đo cần cache; mục tiêu số là đề xuất chủ dự án đổi được ở T-542
- Đường lùi: Viết ADR mới thay ADR-0008 khi có trang công khai cần tĩnh hoặc p95 vượt mục tiêu

### D-028 · 2026-11-24T01:41:16+00:00 · T-527: dùng gì cho eval/dataset AI khi CI không có khoá mô hình, và FTS dùng cột tsvector hay chỉ mục biểu thức?

- Phương án: (1) Khoá băm sha256 + chỉ số truy xuất tất định tự viết; GIN trên biểu thức to_tsvector('simple', text_folded) · (2) DVC/lakeFS + ragas/deepeval; cột tsvector GENERATED STORED
- Chọn: Khoá băm sha256 + chỉ số truy xuất tất định tự viết; GIN trên biểu thức to_tsvector('simple', text_folded)
- Lý do (tiêu chí chất lượng cuối): CI không được gọi model thật (AI-EVAL-002) nên ragas/deepeval (cần model judge) không chạy được; dataset 50 mẫu nằm trong git, khoá băm đủ để phát hiện lệch; chỉ mục biểu thức cho cùng EXPLAIN (Bitmap Index Scan) mà không thêm cột phải đồng bộ
- Đường lùi: Thêm DVC/ragas khi có model judge hiệu chuẩn; thêm cột search_vector bằng migration expand/contract nếu bảng lớn

### D-029 · 2026-11-24T02:03:28+00:00 · T-528: sản phẩm chưa có tác tử AI — làm đủ hạ tầng tác tử (registry tool, HITL, ngân sách 5 chiều, agent con) hay miễn có điều kiện kiểm được?

- Phương án: (1) Miễn 11 mục tác tử kèm test ranh giới đỏ khi thêm tool-calling hoặc agent; làm thật phần đang có (minh bạch, nhãn AI, escape đầu ra, hành vi bị cấm, sổ hành động) · (2) Dựng khung tác tử đầy đủ trước khi có nhu cầu
- Chọn: Miễn 11 mục tác tử kèm test ranh giới đỏ khi thêm tool-calling hoặc agent; làm thật phần đang có (minh bạch, nhãn AI, escape đầu ra, hành vi bị cấm, sổ hành động)
- Lý do (tiêu chí chất lượng cuối): Mô hình chỉ nhận/trả chữ (H13), một nơi gọi duy nhất; khung tác tử không dùng là bề mặt tấn công và mã chết; test ranh giới buộc làm mục thật khi thêm tool
- Đường lùi: Bỏ miễn trừ và làm các mục khi thêm tool-calling hoặc agent (test agent-boundary sẽ đỏ)

### D-030 · 2026-11-24T02:22:33+00:00 · T-529: bản ghi đồng ý, quyền chủ thể và kiểm kê dữ liệu làm theo hình nào?

- Phương án: (1) Bảng consents chỉ ghi thêm gắn cổng AI đám mây; dịch vụ xuất/xoá tài khoản tự phục vụ; một sổ kiểm kê data-inventory.csv khớp bảng phân loại; hàng chờ DSAR cho khách để người duyệt · (2) Dựng ngay hàng chờ DSAR đầy đủ cho cả khách không có tài khoản và data-map.yaml riêng
- Chọn: Bảng consents chỉ ghi thêm gắn cổng AI đám mây; dịch vụ xuất/xoá tài khoản tự phục vụ; một sổ kiểm kê data-inventory.csv khớp bảng phân loại; hàng chờ DSAR cho khách để người duyệt
- Lý do (tiêu chí chất lượng cuối): Cổng AI đám mây là xử lý duy nhất cần đồng ý; DSAR cho khách cần quyết định pháp lý về vai trò bên xử lý và mốc NĐ 356/2025 chưa đối chiếu bản gốc; hai sổ kiểm kê trùng nội dung dễ lệch
- Đường lùi: Thêm mục đích vào CONSENT_PURPOSES khi có xử lý cần đồng ý mới; làm hàng chờ DSAR khi chủ dự án chốt vai trò và mốc

### D-031 · 2026-11-24T02:42:30+00:00 · T-530: sản phẩm có phục vụ người dùng EU/UK để áp CMP-INTL (GDPR, SCC, hạn DSAR theo vùng) hay chỉ Việt Nam?

- Phương án: (1) Chỉ phục vụ Việt Nam; CMP-INTL miễn có điều kiện kiểm được (test cấm cấu hình EU/UK) · (2) Làm đủ CMP-INTL cho EU/UK/SG/TH/CA ngay từ bây giờ
- Chọn: Chỉ phục vụ Việt Nam; CMP-INTL miễn có điều kiện kiểm được (test cấm cấu hình EU/UK)
- Lý do (tiêu chí chất lượng cuối): Sản phẩm là công cụ nội bộ của Chi nhánh Bình Khí tại Việt Nam, không có dữ liệu hay người dùng ngoài Việt Nam; làm đủ vùng khác là phạm vi không có người dùng, tăng bề mặt sai (số Điều chưa đối chiếu). Cách hiểu chặt: runbook vẫn lấy hạn 72 giờ của luật Việt Nam, và test đỏ nếu mã có cấu hình GDPR/EU.
- Đường lùi: Mở cho người dùng nước khác: bỏ dấu miễn ở 4 MUST CMP-INTL, làm bảng hạn theo vùng ở data-breach.md, hồ sơ SCC/TIA.

### D-032 · 2026-11-24T03:09:33+00:00 · Duyệt 5 spec F-001..F-005 và chỉnh theo hành vi đã triển khai (T-560)

- Phương án: (1) Giữ spec cũ, chỉ thêm ID · (2) Viết lại theo mẫu khung, theo code thật, phiên chính tự duyệt
- Chọn: Viết lại theo mẫu khung, theo code thật, phiên chính tự duyệt
- Lý do (tiêu chí chất lượng cuối): Đúng và an toàn: spec phải mô tả hành vi thật, kiểm được bằng test truy vết AC; ADR-0008 cho phiên chính tự duyệt
- Đường lùi: Khôi phục docs/specs từ commit 48013e9

### D-033 · 2026-11-24T04:09:11+00:00 · Hợp đồng API T-561: thay oasdiff/redocly bằng test so khớp, và phạm vi tick MUST

- Phương án: (1) Tick cả 6 MUST bằng test api-contract · (2) Tick STD-API-001 và BE-API-008 (không áp dụng có điều kiện kiểm được); defer 4 mục cần oasdiff/redocly cho người
- Chọn: Tick STD-API-001 và BE-API-008 (không áp dụng có điều kiện kiểm được); defer 4 mục cần oasdiff/redocly cho người
- Lý do (tiêu chí chất lượng cuối): Đúng và an toàn: test chỉ so thao tác và mã trạng thái, không so từng trường, nên không thể khai là chặn thay đổi phá vỡ theo đúng chữ MUST; thêm phụ thuộc CI là việc cần duyệt
- Đường lùi: Bỏ tick hai mục và xoá dòng defer; hợp đồng và test vẫn giữ

### D-034 · 2026-11-24T04:17:17+00:00 · 0011.down.sql không tiến lại được khi còn bằng chứng nguồn message (T-580)

- Phương án: (1) Sửa 0011.down.sql tại chỗ và cập nhật khoá băm · (2) Giữ migration, thêm bước dọn dữ liệu vào quy trình lùi và test ghi nhận lỗi đã biết; người duyệt việc sửa · (3) Thu hẹp migration_check về migration sau v1.0.0
- Chọn: Giữ migration, thêm bước dọn dữ liệu vào quy trình lùi và test ghi nhận lỗi đã biết; người duyệt việc sửa
- Lý do (tiêu chí chất lượng cuối): Đúng và an toàn: migration đã phát hành không sửa tại chỗ; không làm yếu test; lỗi chỉ lộ khi lùi 0011 trên dữ liệu có bằng chứng message, và v1.0.0 là bản đầu nên chưa có đường lùi về trạng thái trước đó
- Đường lùi: Bỏ bước dọn trong tests/db/migration-data.test.ts và ca lỗi đã biết; test đỏ trở lại ở ca 0011

### D-035 · 2026-11-24T04:41:38+00:00 · T-582: đóng với 4/6 nhóm tấn công?

- Phương án: (1) A: viết nốt SSRF và dò mật khẩu · (2) B: đóng 4 nhóm, ghi khoảng thiếu và phát hiện
- Chọn: B: đóng 4 nhóm, ghi khoảng thiếu và phát hiện
- Lý do (tiêu chí chất lượng cuối): Hết trần vòng; 111 test xanh; phần thiếu và phát hiện ghi vào PROGRESS cho phiên sau
- Đường lùi: Viết nốt nhóm SSRF và dò mật khẩu, mở lại tick T-582
