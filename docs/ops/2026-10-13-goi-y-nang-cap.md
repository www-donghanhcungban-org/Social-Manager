# Gợi ý nâng cấp — rà soát 2026-10-13

> Lấy từ đợt rà soát chéo 19 repo của chủ sở hữu (ma trận vệ sinh ở [seeker19110/stored, mục 23 §8.1](https://github.com/seeker19110/stored/blob/main/23-own-repos-lessons/README.md); gợi ý tích hợp ở §7b của cùng file). Số liệu đo bằng lệnh trên HEAD (đếm `uses:` ghim SHA 40 ký tự, khối `permissions:`, `dependabot.yml`, `.claude/settings.json`), không suy ra từ văn xuôi. Đây là **đề xuất**, chưa sửa code. Mỗi mục kèm bằng chứng để kiểm lại trước khi làm; mục nào đã xử lý thì đánh dấu hoặc xoá.

## Hiện trạng đo được

| HEAD đọc | Action ghim SHA | Workflow thiếu `permissions:` cấp đầu | Dependabot | LICENSE · SECURITY | File test |
|---|---|---|---|---|---|
| `a95e95f` (2026-10-09) | 19/19 | – | npm, github-actions, pip | không · có | 5 |

## Đề xuất (🔴 cao · 🟠 trung bình · 🟢 nhẹ)

| # | Mức | Đề xuất | Bằng chứng | Kiểm xong khi |
|---|---|---|---|---|
| 1 | 🟠 | Khôi phục `AGENTS.md`: chuyển khối `<!-- BEGIN:nextjs-agent-rules -->` vào một mục riêng, rồi viết lại tóm tắt luật theo `CLAUDE.md:20` | `AGENTS.md` chỉ còn 9 dòng, toàn là khối do `next dev` sinh, trong khi `CLAUDE.md:20` nói AGENTS.md là tóm tắt luật cho agent ngoài Claude Code. Lỗi ghi từ ngày 12/10 và vẫn còn | AGENTS.md có luật cốt lõi; chạy `next dev` không ghi đè nữa (khối Next nằm giữa marker riêng) |
| 2 | 🟢 | Thêm `auto-complete-guard.sh` vào Stop | Stop hiện chỉ gọi `usage-guard.sh` và `telemetry-record.sh` | Có trong `.claude/settings.json` |
| 3 | 🟢 | Đổi `"model": "claude-sonnet-5"` sang `claude-sonnet-5-5` | `.claude/settings.json` ghi `claude-sonnet-5` | — |

## Giữ nguyên (điểm mạnh)

- 19/19 action ghim SHA, Dependabot npm + github-actions + pip gom nhóm theo WIP cap, rulesets-as-code.

## Gợi ý tích hợp từ catalog `stored`

- OSV-Scanner / OpenSSF Scorecard, và dependency-cruiser làm cổng import-graph trong CI (stored mục 12 §3d, mục 16 §2c).

## Ghi chú chung

- Ghim action theo SHA bằng [pinact](https://github.com/suzuki-shunsuke/pinact) hoặc [ratchet](https://github.com/sethvargo/ratchet), giữ comment tag (`# v7.0.1`), rồi để Dependabot `github-actions` tự nâng SHA. Đây là cách projects-template, xboss và Sales-Hunter đang làm.
- Chuẩn tham chiếu là `seeker19110/projects-template`: 25/25 action ghim SHA, mọi workflow có `permissions:` cấp đầu, Dependabot cho npm, github-actions và pip.
