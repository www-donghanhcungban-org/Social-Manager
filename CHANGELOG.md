# Changelog

Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/); phiên bản theo [SemVer](https://semver.org/lang/vi/).

## 1.0.0 (2026-11-22)


### Features

* Social Manager — nền tảng, hộp thư, đăng bài, webhook, bảo mật và triển khai (T-001..T-038) ([#18](https://github.com/www-donghanhcungban-org/Social-Manager/issues/18)) ([a24ca77](https://github.com/www-donghanhcungban-org/Social-Manager/commit/a24ca77401d09a6f317cab61d171faafd4b3e655))

## [Unreleased]

### Added

- Lớp nhà cung cấp cắm được: registry, ma trận tính năng, hợp đồng hành động, nhà cung cấp demo và adapter SocialAPI (đăng bài + tin nhắn).
- Mã hoá AES-256-GCM cho khoá nhà cung cấp lưu trong DB.
- Schema Postgres (Drizzle) và migration có đường lùi: workspace, thành viên, kết nối, tài khoản mạng xã hội.
- Đăng nhập email + mật khẩu (Better Auth) và phân quyền owner/admin/member.
- Kiểm cấu hình lúc khởi động, che bí mật khi log.

[Unreleased]: https://github.com/www-donghanhcungban-org/social-manager/commits/main
