---
status: accepted
implementation-status: partial
date: 2026-11-22
decision-makers: chủ dự án (yêu cầu "chuyển thể hết bộ khung thành của dự án", chọn hướng tiếp quản và may đo, giữ Python — 2026-11-22); phiên chính (cách làm, theo AGENTS.md §5)
consulted: không
informed: không
---

# ADR-0003: Tiếp quản công cụ quy trình X-Templates thành công cụ của dự án

## Bối cảnh và vấn đề

Repo chứa hai lớp công cụ quy trình: (1) X-Templates 3.35.0 cài ở `.xtemplates/` (`xt.py` khoảng 23.000 dòng, guard
khoảng 24.000 dòng, hook, skill, agent, CI) do `install.py` và workflow `xt-upgrade.yml` quản lý; (2) di sản
projects-template cũ (21 script trong `scripts/`, 3 test Python, 13 lệnh `.claude/commands/`, 10 agent, 8 hook). Đo
ngày 2026-11-22: 8 hook cũ là tệp mode 644 gọi trực tiếp nên mỗi lần chạy đều thoát 126 và không làm gì; các agent cũ
ghim model và trỏ tới script không còn. Chủ dự án yêu cầu biến phần chạy trên dự án thành của dự án.

## Các phương án đã cân nhắc

1. **Tiếp quản tại chỗ**: giữ đường dẫn `.xtemplates/`, bỏ cơ chế quản lý bản cài (manifest, băm harness, workflow
   nâng khung), gỡ di sản, may đo tài liệu vận hành.
2. Dời sang `tools/xt/` + `docs/process/`: phải sửa cách `xt.py` nhận diện gốc dự án (41 chỗ) và cách guard nhận
   diện dự án đích (`is_target_project`) cùng danh sách đường dẫn được bảo vệ (`GATE_PATTERNS` có `.xtemplates/*`).
3. Viết lại sang TypeScript (chủ dự án không chọn).

## Quyết định

Phương án 1. Đã làm trong PR này:

- Gỡ `.xtemplates/manifest.json`, `.xtemplates/harness.sha256.json`, `.github/workflows/xt-upgrade.yml`; đổi
  `.xtemplates/VERSION` thành nhãn của dự án (không phải SemVer nên `doctor` thôi nhắc nâng khung) và
  `.xtemplates/README.md` thành tài liệu của dự án.
- Gỡ 30 script và 4 tệp Python của projects-template, 2 tệp mẫu `.claude/*.example.sh`, 4 tài liệu `docs/ops` của bộ
  cũ; bỏ đăng ký 8 hook chết khỏi `.claude/settings.json` (hook còn đăng ký đều là hook của bộ đang dùng, gọi qua `bash`).
- May đo `AGENTS.md`, `CLAUDE.md`, `.gitignore`.

Không làm được, cần người (guard chặn, "bị chặn là kết luận"): xoá tệp hook cũ trong `.claude/hooks/` (ghi/xoá hàng rào
qua Bash bị chặn), xoá 10 agent và 13 lệnh cũ trong `.claude/agents/`, `.claude/commands/` (thay đổi năng lực agent
cần người duyệt, LOOP-STOP-023). Lệnh để người chạy nằm ở PROGRESS.md.

## Lý do

Phương án 2 chạm đúng phần quyết định hàng rào: dời đường dẫn mà sót một chỗ thì guard coi repo là "repo khung" và
thôi hỏi khi sửa agent/skill, hoặc thôi bảo vệ chính công cụ. Tiêu chí 1 (đúng và an toàn) thắng tiêu chí 4 (tên thư
mục đẹp). Phương án 1 đạt mục tiêu thực chất — công cụ thôi là bản cài do bên ngoài quản lý, không còn tệp chết — với
rủi ro thấp, đo được bằng `xt.py doctor`, `xt.py ci-check` và cổng.

## Hệ quả

- Tích cực: không còn PR nâng khung tự động đè lên tuỳ chỉnh; không còn hook lỗi 126 ở mỗi lượt; doctor bớt cảnh báo
  provenance.
- Đánh đổi: tự chịu bảo trì 47.000 dòng Python; bản sửa của X-Templates phải chép tay (ghi SHA nguồn).
- Đường lùi: khôi phục các tệp đã gỡ bằng `git revert` commit tiếp quản, hoặc cài lại khung bằng `install.py`.
