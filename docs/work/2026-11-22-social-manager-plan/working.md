# Nghiên cứu & kế hoạch: Social Manager (bản cải tiến)

- Trạng thái: **CHỜ DUYỆT** — chưa viết dòng code ứng dụng nào (feature gate, CLAUDE.md §2).
- Ngày: 2026-11-22 · Giai đoạn: GĐ 0–2 (ý tưởng → nghiên cứu → kế hoạch).
- Nguồn tham chiếu: `qthupro/socials-manager` @ `640fb62` (v0.1.4, 2026-11-19, giấy phép MIT).

## 1. Phần mềm tham chiếu là gì

Ứng dụng desktop **chỉ chạy Windows**: Tauri 2 (Rust) + React 19 + Vite 8 + Tailwind 4 + shadcn/ui,
khoảng 29.000 dòng. Không đăng nhập, không backend riêng; mọi dữ liệu nằm trong `localStorage`.

Nó là **lớp giao diện mỏng trên SocialAPI** (`api.social-api.ai/v1`, dịch vụ trả phí của bên thứ ba).
Mọi thao tác với mạng xã hội đều đi qua API key SocialAPI của người dùng.

| Nhóm | Tính năng hiện có |
|---|---|
| Hộp thư | Tin nhắn (DM), bình luận, đánh giá, lượt nhắc; trợ lý AI gợi ý trả lời |
| Tự động trả lời | Bot DM theo "nhân viên AI" (tính cách, kho kiến thức, xin SĐT/Zalo); bot bình luận (tự thích, trả lời theo từ khoá hoặc AI, nhắn riêng); automation phía SocialAPI cho Instagram/Facebook |
| Đăng bài | Soạn bài (bài viết/video/reel/story), chọn kênh, AI viết bài, xem trước, lịch đăng, hàng đợi, thư viện media |
| Phân tích | Thống kê, xuất báo cáo |
| Kết nối | Tài khoản, Facebook Page, thương hiệu (brand) |
| Nhà phát triển | Webhook, nhật ký sự kiện, API key |
| Hệ thống | 4 nhà cung cấp AI (Claude, ChatGPT, Gemini, DeepSeek), realtime qua Convex, khay hệ thống, thông báo, tự khởi động |

SocialAPI hỗ trợ 14 nền tảng (Facebook, Instagram, Threads, TikTok, LinkedIn, X, YouTube, Pinterest,
Zalo, WhatsApp, Telegram, Bluesky, Google Business Profile, App Store Connect); mỗi nền tảng có tập
khả năng khác nhau. Giá (xem ngày 2026-11-22): miễn phí 2 hồ sơ / 10 bài / 50 tương tác mỗi tháng;
29 USD cho 10 hồ sơ; 109 USD cho 50; 349 USD cho 200. Đọc dữ liệu không tính phí.

## 2. Điểm yếu đã xác minh trong mã nguồn

| # | Điểm yếu | Bằng chứng |
|---|---|---|
| 1 | Bot chỉ chạy khi app đang mở trên máy | `inbox/messages/bot/engine.tsx`, `inbox/comments/automation/engine.tsx` là component React |
| 2 | Không có webhook thì chỉ dò định kỳ 45–60 giây | `POLL_MS` trong hai engine trên |
| 3 | Muốn realtime phải tự triển khai một Convex riêng | `convex/`, `features/realtime/backend/deploy.ts` |
| 4 | API key lưu dạng văn bản thường trong `localStorage`; CSP tắt | `shared/api/api-key-store.ts`, `tauri.conf.json` (`"csp": null`) |
| 5 | Dữ liệu khách hàng nằm trong `localStorage` của một máy | `inbox/messages/store/customers-store.ts` |
| 6 | Một người dùng, không phân quyền, không phân công hội thoại | không có khái niệm user/role trong mã |
| 7 | Chỉ Windows, không dùng được trên điện thoại | README, `release.yml` |
| 8 | Không có test tự động nào; CI chỉ có workflow phát hành | `git ls-files` không có file test |
| 9 | Gắn cứng vào SocialAPI | `API_BASE_URL` hằng số, kiểu dữ liệu theo đúng SocialAPI |
| 10 | Giao diện chỉ tiếng Việt, chuỗi viết thẳng trong component | toàn bộ `src/features` |

## 3. Đề xuất: bản cải tiến

**Hình thái: ứng dụng web tự host (kiêm PWA cài được trên điện thoại), có server riêng.**
Đây là thay đổi gốc; một server chạy liên tục giải quyết cùng lúc các điểm yếu 1–7.
Repo này đã là scaffold Next.js 16 nên không phải dựng lại từ đầu.

| Cải tiến | So với bản gốc |
|---|---|
| Tự động hoá chạy 24/7 trên server (hàng đợi job) | Bản gốc dừng khi tắt máy |
| Webhook về thẳng server, đẩy tới trình duyệt qua SSE | Bỏ bước tự triển khai Convex |
| Khoá API mã hoá phía server, không bao giờ xuống trình duyệt | Bản gốc lưu văn bản thường |
| Nhiều người dùng: vai trò, phân công hội thoại, ghi chú nội bộ, trạng thái mở/đã xử lý | Bản gốc một người |
| CRM nhẹ trong cơ sở dữ liệu: khách hàng, thẻ, SĐT thu được, xuất CSV | Bản gốc lưu trong `localStorage` |
| AI an toàn hơn: chế độ "soạn nháp chờ duyệt", chuyển cho người khi không chắc, trần chi phí mỗi ngày, nhật ký mọi hành động tự động | Bản gốc gửi thẳng |
| Đăng bài: nội dung riêng theo từng kênh, quy trình duyệt bài, nhập hàng loạt từ CSV | Bản gốc một nội dung cho mọi kênh |
| Chạy mọi hệ điều hành và điện thoại | Bản gốc chỉ Windows |
| Lớp adapter nhà cung cấp | Đổi hoặc thêm nguồn ngoài SocialAPI mà không sửa tính năng |
| Test + cổng CI từ ngày đầu; i18n vi/en | Bản gốc không có |

Giữ nguyên từ bản gốc: SocialAPI làm nhà cung cấp đầu tiên, 4 nhà cung cấp AI, cấu trúc
feature-module, bộ tính năng ở mục 1. Bản gốc dùng React 19 + Tailwind 4 + shadcn/ui giống repo này
và có giấy phép MIT, nên phần lớn component giao diện **chuyển sang dùng lại được** (giữ ghi công).

Cái giá của hướng này: cần một máy chủ (VPS nhỏ hoặc Docker trên máy cá nhân) và phải đăng nhập.

### Stack đề xuất

Next.js 16 + React 19 + TypeScript strict + Tailwind 4 + shadcn/ui (đã có trong repo) ·
PostgreSQL + Drizzle ORM · Better Auth · pg-boss (hàng đợi job trên Postgres, không cần Redis) ·
Zod · TanStack Query · Vitest + Playwright · Docker Compose.

Phiên bản cụ thể chưa xác minh; sẽ chốt bằng nguồn sống ở đợt 0 và ghi vào ADR.

## 4. Lộ trình

Mỗi dòng là một PR; mỗi đợt kết thúc bằng một bản chạy được. Đợt 1–4 thuộc mức M/L nên mỗi đợt có
spec riêng trong `docs/specs/` được duyệt trước khi code.

| Đợt | Kết quả | Các PR chính |
|---|---|---|
| 0. Nền | Đăng nhập được, CI xanh, chạy bằng Docker | ADR stack + `PROJECT.md`; schema + migration; đăng nhập và workspace; kho bí mật mã hoá; client SocialAPI (Zod, retry theo `Retry-After`); khung giao diện + theme |
| 1. Kết nối & đăng bài | Kết nối tài khoản, đăng và lên lịch bài | tài khoản/brand; soạn bài + xem trước; lịch + hàng đợi; thư viện media; nội dung theo kênh |
| 2. Hộp thư hợp nhất | Trả lời DM/bình luận/đánh giá/lượt nhắc theo thời gian thực | nhận webhook (kiểm chữ ký HMAC) + SSE; DM; bình luận; đánh giá + lượt nhắc; phân công, thẻ, ghi chú, câu trả lời mẫu |
| 3. AI & tự động hoá | Bot trả lời 24/7 có kiểm soát | adapter AI 4 nhà cung cấp; kho kiến thức + persona; bot DM; bot bình luận; chế độ duyệt nháp + chuyển người + trần chi phí; nhật ký tự động hoá |
| 4. Phân tích & CRM | Báo cáo và danh sách khách hàng | bảng thống kê; xuất báo cáo; khách hàng + xuất CSV |
| 5. Hoàn thiện | Sẵn sàng phát hành | PWA + thông báo đẩy; i18n vi/en; rà a11y và hiệu năng; audit toàn diện; tài liệu triển khai |

Để sau MVP (chỉ làm khi có nhu cầu thật): gợi ý giờ đăng tốt nhất, duyệt bài nhiều cấp, bản
desktop bọc Tauri, kết nối trực tiếp API của từng nền tảng.

## 5. Ba quyết định cần người dùng chốt

1. **Hình thái:** web tự host có server (đề xuất) hay desktop Tauri như bản gốc. Desktop không cần
   máy chủ nhưng giữ nguyên điểm yếu 1, 6, 7.
2. **Nguồn dữ liệu mạng xã hội:** tiếp tục dùng SocialAPI (đề xuất; tốn từ 29 USD/tháng khi quá 2 hồ
   sơ) hay gọi thẳng API từng nền tảng (không phí trung gian nhưng phải tự xin duyệt app với Meta,
   TikTok… — thường kéo dài nhiều tuần và mỗi nền tảng là một tích hợp riêng).
3. **Nhiều người dùng trong MVP:** đề xuất schema sẵn cho nhóm ngay từ đợt 0, giao diện phân công
   ở đợt 2. Nếu chỉ một người dùng thì bỏ được phần phân công, rút khoảng 2 PR.

## 6. Rủi ro

- Phụ thuộc SocialAPI về giá, giới hạn và thời gian hoạt động; adapter giảm công chuyển đổi nhưng
  không loại bỏ rủi ro.
- Tự động trả lời bằng AI có thể vi phạm chính sách nền tảng (ví dụ cửa sổ 24 giờ của Messenger);
  bot phải tôn trọng `capabilities` mà API trả về.
- Lưu tin nhắn và SĐT khách hàng là dữ liệu cá nhân: cần mã hoá khi lưu, quyền truy cập theo
  workspace, chức năng xoá dữ liệu.

## 7. Bước tiếp theo

Sau khi ba quyết định ở mục 5 được chốt: viết ADR-stack và `PROJECT.md`, rồi bắt đầu đợt 0.
