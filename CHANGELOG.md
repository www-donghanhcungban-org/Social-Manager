# Changelog

Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/); phiên bản theo [SemVer](https://semver.org/lang/vi/).

## [1.0.1](https://github.com/www-donghanhcungban-org/X-Workspace/compare/v1.0.0...v1.0.1) (2026-11-24)


### Bug Fixes

* đợt 1 harden — đường gửi tin, CI Postgres, SECURITY.md, miễn/tick MUST (T-502..T-512) ([#37](https://github.com/www-donghanhcungban-org/X-Workspace/issues/37)) ([e84b931](https://github.com/www-donghanhcungban-org/X-Workspace/commit/e84b931ed7a0cad007d8c935b87bac6ab8b1a74b))

## 1.0.0 (2026-11-23)


### Features

* đợt xw-2 — kho bằng chứng, dự án, xoá/xuất xuyên lớp, connector GitHub ([#25](https://github.com/www-donghanhcungban-org/X-Workspace/issues/25)) ([bcceb09](https://github.com/www-donghanhcungban-org/X-Workspace/commit/bcceb0933c1c3a09bc246d7d01bd3983b89ef4e8))
* đợt xw-4 — nháp, sổ hành động gửi đúng một lần, đối soát send_unknown, job nền ([#27](https://github.com/www-donghanhcungban-org/X-Workspace/issues/27)) ([c20fa6a](https://github.com/www-donghanhcungban-org/X-Workspace/commit/c20fa6a8d4426c92e0dad607386b95f924384cd8))
* đợt xw-4b — giao diện hội thoại, soạn nháp và yêu cầu gửi ([#28](https://github.com/www-donghanhcungban-org/X-Workspace/issues/28)) ([66411e9](https://github.com/www-donghanhcungban-org/X-Workspace/commit/66411e97ff72e0c1e55b512cf93d30aaa2e0159f))
* đợt xw-4c — trang tìm kiếm và hỏi đáp có trích dẫn ([#29](https://github.com/www-donghanhcungban-org/X-Workspace/issues/29)) ([ceea920](https://github.com/www-donghanhcungban-org/X-Workspace/commit/ceea920dc043d975eaefad0bbf8baa2d05ec538f))
* đợt xw-4d — trang nhập tài liệu và quản lý dự án ([#30](https://github.com/www-donghanhcungban-org/X-Workspace/issues/30)) ([88ed598](https://github.com/www-donghanhcungban-org/X-Workspace/commit/88ed5983f6c9dad57108547ded74cd3d2d603db7))
* đợt xw-4e — trang dự án (sổ quyết định, dòng thời gian, bí danh) ([#33](https://github.com/www-donghanhcungban-org/X-Workspace/issues/33)) ([280fc87](https://github.com/www-donghanhcungban-org/X-Workspace/commit/280fc87152dbceb89160e20f601151bda7847ce0))
* nền X-Workspace xw-1 — hội thoại, trạng thái bài trung thực, hạn lưu theo workspace ([#23](https://github.com/www-donghanhcungban-org/X-Workspace/issues/23)) ([f405483](https://github.com/www-donghanhcungban-org/X-Workspace/commit/f4054832408ba9bc740b14251c73678fb0278ec7))
* quản lý bí danh dự án ([#32](https://github.com/www-donghanhcungban-org/X-Workspace/issues/32)) ([5cc5fe6](https://github.com/www-donghanhcungban-org/X-Workspace/commit/5cc5fe6afb57d301883f6955cb6c25e74436427b))
* Social Manager — nền tảng, hộp thư, đăng bài, webhook, bảo mật và triển khai (T-001..T-038) ([#18](https://github.com/www-donghanhcungban-org/X-Workspace/issues/18)) ([a24ca77](https://github.com/www-donghanhcungban-org/X-Workspace/commit/a24ca77401d09a6f317cab61d171faafd4b3e655))
* xw-3 tìm kiếm tiếng Việt, sổ quyết định, cổng AI và hỏi đáp có trích dẫn ([#26](https://github.com/www-donghanhcungban-org/X-Workspace/issues/26)) ([4a9738d](https://github.com/www-donghanhcungban-org/X-Workspace/commit/4a9738d54ab14bc05c39869e8e1cf13e4ced7a8c))


### Bug Fixes

* **deploy:** chuyển AI_* và OUTBOUND_LIVE vào container app ([#31](https://github.com/www-donghanhcungban-org/X-Workspace/issues/31)) ([375872e](https://github.com/www-donghanhcungban-org/X-Workspace/commit/375872e702b124b86ecfe4ddca2c68b349dc2e70))
* **test:** CHANGELOG sau phát hành mở đầu bằng bản phiên bản, không chỉ [Unreleased] ([#34](https://github.com/www-donghanhcungban-org/X-Workspace/issues/34)) ([5853c60](https://github.com/www-donghanhcungban-org/X-Workspace/commit/5853c60fc788040d97cfd9481dd72ffbf19c4870))

## [Unreleased]

### Added

- Lớp nhà cung cấp cắm được: registry, ma trận tính năng, hợp đồng hành động, nhà cung cấp demo và adapter SocialAPI (đăng bài + tin nhắn).
- Mã hoá AES-256-GCM cho khoá nhà cung cấp lưu trong DB.
- Schema Postgres (Drizzle) và migration có đường lùi: workspace, thành viên, kết nối, tài khoản mạng xã hội.
- Đăng nhập email + mật khẩu (Better Auth) và phân quyền owner/admin/member.
- Kiểm cấu hình lúc khởi động, che bí mật khi log.

[Unreleased]: https://github.com/www-donghanhcungban-org/X-Workspace/commits/main
