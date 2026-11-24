# Thông báo phụ thuộc bên thứ ba

Tệp này **sinh tự động** từ `package-lock.json` và `license-policy.json` (cập nhật: `UPDATE_NOTICES=1 npx vitest run tests/config/licenses.test.ts`).
Liệt kê gói dùng license cần ghi công hoặc ngoại lệ có hạn; các gói còn lại dùng license cho phép (MIT, Apache-2.0, ISC, BSD, …) — danh sách đầy đủ trong SBOM (`sbom.cdx.json`, artifact CI).

| Gói                                  | Phiên bản    | License                                  | Ghi chú                 |
| ------------------------------------ | ------------ | ---------------------------------------- | ----------------------- |
| `@axe-core/playwright`               | 4.14.0       | MPL-2.0                                  | ngoại lệ đến 2027-06-30 |
| `@img/sharp-libvips-darwin-arm64`    | 1.3.4        | LGPL-3.0-or-later                        | ngoại lệ đến 2027-06-30 |
| `@img/sharp-libvips-darwin-x64`      | 1.3.4        | LGPL-3.0-or-later                        | ngoại lệ đến 2027-06-30 |
| `@img/sharp-libvips-linux-arm`       | 1.3.4        | LGPL-3.0-or-later                        | ngoại lệ đến 2027-06-30 |
| `@img/sharp-libvips-linux-arm64`     | 1.3.4        | LGPL-3.0-or-later                        | ngoại lệ đến 2027-06-30 |
| `@img/sharp-libvips-linux-ppc64`     | 1.3.4        | LGPL-3.0-or-later                        | ngoại lệ đến 2027-06-30 |
| `@img/sharp-libvips-linux-riscv64`   | 1.3.4        | LGPL-3.0-or-later                        | ngoại lệ đến 2027-06-30 |
| `@img/sharp-libvips-linux-s390x`     | 1.3.4        | LGPL-3.0-or-later                        | ngoại lệ đến 2027-06-30 |
| `@img/sharp-libvips-linux-x64`       | 1.3.4        | LGPL-3.0-or-later                        | ngoại lệ đến 2027-06-30 |
| `@img/sharp-libvips-linuxmusl-arm64` | 1.3.4        | LGPL-3.0-or-later                        | ngoại lệ đến 2027-06-30 |
| `@img/sharp-libvips-linuxmusl-x64`   | 1.3.4        | LGPL-3.0-or-later                        | ngoại lệ đến 2027-06-30 |
| `@img/sharp-wasm32`                  | 0.35.5       | Apache-2.0 AND LGPL-3.0-or-later AND MIT | ngoại lệ đến 2027-06-30 |
| `@img/sharp-win32-arm64`             | 0.35.5       | Apache-2.0 AND LGPL-3.0-or-later         | ngoại lệ đến 2027-06-30 |
| `@img/sharp-win32-ia32`              | 0.35.5       | Apache-2.0 AND LGPL-3.0-or-later         | ngoại lệ đến 2027-06-30 |
| `@img/sharp-win32-x64`               | 0.35.5       | Apache-2.0 AND LGPL-3.0-or-later         | ngoại lệ đến 2027-06-30 |
| `axe-core`                           | 4.14.0       | MPL-2.0                                  | ngoại lệ đến 2027-06-30 |
| `caniuse-lite`                       | 1.0.30001815 | CC-BY-4.0                                | ngoại lệ đến 2027-06-30 |
| `lightningcss`                       | 1.33.0       | MPL-2.0                                  | ngoại lệ đến 2027-06-30 |
| `lightningcss-android-arm64`         | 1.33.0       | MPL-2.0                                  | ngoại lệ đến 2027-06-30 |
| `lightningcss-darwin-arm64`          | 1.33.0       | MPL-2.0                                  | ngoại lệ đến 2027-06-30 |
| `lightningcss-darwin-x64`            | 1.33.0       | MPL-2.0                                  | ngoại lệ đến 2027-06-30 |
| `lightningcss-freebsd-x64`           | 1.33.0       | MPL-2.0                                  | ngoại lệ đến 2027-06-30 |
| `lightningcss-linux-arm-gnueabihf`   | 1.33.0       | MPL-2.0                                  | ngoại lệ đến 2027-06-30 |
| `lightningcss-linux-arm64-gnu`       | 1.33.0       | MPL-2.0                                  | ngoại lệ đến 2027-06-30 |
| `lightningcss-linux-arm64-musl`      | 1.33.0       | MPL-2.0                                  | ngoại lệ đến 2027-06-30 |
| `lightningcss-linux-x64-gnu`         | 1.33.0       | MPL-2.0                                  | ngoại lệ đến 2027-06-30 |
| `lightningcss-linux-x64-musl`        | 1.33.0       | MPL-2.0                                  | ngoại lệ đến 2027-06-30 |
| `lightningcss-win32-arm64-msvc`      | 1.33.0       | MPL-2.0                                  | ngoại lệ đến 2027-06-30 |
| `lightningcss-win32-x64-msvc`        | 1.33.0       | MPL-2.0                                  | ngoại lệ đến 2027-06-30 |

- `caniuse-lite` (CC-BY-4.0): © Alexis Deveria, Lars Kappert và cộng tác viên — dữ liệu từ caniuse.com, dùng theo giấy phép CC-BY-4.0 (https://creativecommons.org/licenses/by/4.0/).
- `@img/sharp-*` (LGPL-3.0-or-later): nhị phân libvips của sharp, dùng nguyên bản như thư viện liên kết động.
- `lightningcss`, `axe-core` (MPL-2.0): dùng nguyên bản, không sửa mã nguồn.
