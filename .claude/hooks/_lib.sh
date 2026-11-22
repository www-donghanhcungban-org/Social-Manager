#!/usr/bin/env bash
# _lib.sh — hàm dùng chung cho các hook PreToolUse soi lệnh Bash (block-dangerous-git.sh, pre-commit-gate.sh).
# CHỈ để `source "$(dirname "$0")/_lib.sh"`, không tự chạy, không nối vào settings*.json. Không `set` gì ở đây:
# hook gọi đã tự đặt shell option (cố ý KHÔNG -e — docs/CONVENTIONS.md §A).
#
# VÌ SAO TÁCH RA (O-2, 2026-10-08 — TRAPS.md "bản sao hook lệch nhau"): hai hook từng giữ HAI BẢN SAO bộ lọc
# "bỏ dữ liệu trước khi so khớp". Lần sửa heredoc 2026-09-14 chỉ vào block-dangerous-git, nên pre-commit-gate
# vẫn coi thân heredoc là lệnh: `python3 - <<PY … git commit … PY` chạy cổng oan, message heredoc nhắc
# `git add` bật chế độ tự-stage oan. Một bản duy nhất ở đây = sửa một chỗ, cả hai hook cùng nhận.
# Chốt chặn: `scripts/test-hooks-gate.sh` mục 8 (block-dangerous-git) + mục 16 (pre-commit-gate).

# In lệnh Bash sắp chạy (`.tool_input.command`) từ payload JSON trên stdin; rỗng nếu không có.
# Hook gọi PHẢI tự kiểm `command -v jq` trước (mỗi hook giữ thông báo fail-open-có-cảnh-báo riêng).
read_hook_command() {
  jq -r '.tool_input.command // empty' 2>/dev/null
}

# ── Hàm của khung X-Templates (gộp từ _lib.sh.xtemplates-new; hook của khung gọi các hàm này) ──
# Mọi hook: fail-open (lỗi của hook không được kẹt phiên), chỉ dùng bash + python3 (jq tùy chọn).

XT_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# Đường dẫn xt.py: dự án đích cài khung vào .xtemplates/, còn repo khung thì ở scripts/.
xt_py() {
  for p in "$XT_ROOT/.xtemplates/scripts/xt.py" "$XT_ROOT/scripts/xt.py"; do
    [ -f "$p" ] && { printf '%s' "$p"; return 0; }
  done
  return 1
}

# Chạy file Python của khung như module (`main()`), sys.path[0] = thư mục của file như khi chạy script (không lấy cwd).
# `-I` (cách ly) bỏ PYTHON*, user-site và cwd; `-B` không ghi bytecode. Không cache bytecode (AUD-SEC-074).
py_run() { # $1=đường dẫn .py (có main()) $2…=đối số
  python3 -I -B -c 'import sys
p = sys.argv[1]
d, _, f = p.rpartition("/")
sys.path.insert(0, d or ".")
code = compile(open(p, "rb").read(), p, "exec", dont_inherit=True)
m = type(sys)(f[:-3])
m.__file__ = p
sys.modules[m.__name__] = m
sys.argv = sys.argv[1:]
exec(code, m.__dict__)
sys.exit(m.main())
' "$@"
}

# Chạy guard.py một lần, đặt XG_DECISION XG_REASON XG_COMMIT XG_NO_VERIFY XG_COMMIT_DIR (định dạng `nul` của guard.py).
# Trả 1 khi guard.py không trả kết quả. Gọi bằng `guard_fields <mode> <<<"$payload"` (không qua ống).
# shellcheck disable=SC2034 # XG_* là kết quả cho hook đã source file này
guard_fields() { # $1=bash|edit|mcp
  local ok=""
  XG_DECISION="" XG_REASON="" XG_COMMIT="" XG_NO_VERIFY="" XG_COMMIT_DIR=""
  {
    IFS= read -r -d '' ok
    IFS= read -r -d '' XG_DECISION
    IFS= read -r -d '' XG_REASON
    IFS= read -r -d '' XG_COMMIT
    IFS= read -r -d '' XG_NO_VERIFY
    IFS= read -r -d '' XG_COMMIT_DIR
  } < <(CLAUDE_PROJECT_DIR="$XT_ROOT" py_run "$(dirname "$0")/guard.py" "$1" nul 2>/dev/null)
  [ "$ok" = ok ]
}

# Đọc một trường trong payload JSON (stdin của hook) bằng python3; rỗng nếu thiếu.
json_field() { # $1=payload $2=đường dẫn dạng a.b.c
  printf '%s' "$1" | python3 -I -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for k in sys.argv[1].split("."):
    d = d.get(k) if isinstance(d, dict) else None
    if d is None:
        sys.exit(0)
sys.stdout.write(d if isinstance(d, str) else json.dumps(d, ensure_ascii=False))
' "$2" 2>/dev/null
}

# In JSON quyết định PreToolUse (deny|ask|allow) kèm lý do, rồi exit 0.
pretool_decision() { # $1=deny|ask $2=lý do
  python3 -I -c '
import json, sys
print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse",
      "permissionDecision": sys.argv[1], "permissionDecisionReason": sys.argv[2]}}, ensure_ascii=False))
' "$1" "$2"
  exit 0
}

# Hỏi người CHỈ khi `XT_GUARD_POLICY=strict`; mặc định cho qua (ADR-0018). Luôn exit 0.
ask_strict() { # $1=lý do
  [ "${XT_GUARD_POLICY:-}" = strict ] && pretool_decision ask "$1"
  exit 0
}

# Không kiểm được thứ phải kiểm (ADR-0019, AUD-SEC-045): strict hỏi, mặc định CHẶN. Luôn exit 0.
fence_closed() { # $1=lý do
  [ "${XT_GUARD_POLICY:-}" = strict ] && pretool_decision ask "$1"
  pretool_decision deny "${1#Khung cần xác nhận: }"
}

# Cắt stdin tối đa $1 byte KHÔNG cắt giữa ký tự UTF-8 (AUD-HAR-011).
utf8_head() {
  python3 -I -c 'import sys; sys.stdout.write(sys.stdin.buffer.read()[: int(sys.argv[1])].decode("utf-8", "ignore"))' "$1" 2>/dev/null
}

# In JSON additionalContext cho SessionStart/UserPromptSubmit.
context_output() { # $1=hookEventName $2=nội dung
  python3 -I -c '
import json, sys
print(json.dumps({"hookSpecificOutput": {"hookEventName": sys.argv[1],
      "additionalContext": sys.argv[2]}}, ensure_ascii=False))
' "$1" "$2"
}

# Bỏ DỮ LIỆU trước khi so khớp, chỉ giữ phần thực sự là lệnh. Hai dạng nhúng dữ liệu nhiều từ vào
# một lệnh shell, và cả hai đều đã gây chặn oan thật:
#
#   1. Trong dấu nháy (audit 2026-09-12): `echo 'git reset --hard ...'` bị coi là lệnh git thật.
#   2. Trong thân heredoc (2026-09-14): `git commit -F - <<EOF ... EOF && git push -u origin
#      claude/<nhánh> --force-with-lease` bị quy tắc 1 chặn vì COMMIT MESSAGE có chữ "main" đứng
#      riêng ("quay về main"), dù nhánh đích là nhánh riêng. Cùng lượt đó quy tắc 2 cũng chặn oan
#      một lệnh `python3 - <<PY` mà thân script có chuỗi `git reset --hard` làm dữ liệu test.
#
# Đây là khuôn "bộ đếm/bộ dò tự khớp văn bản của chính thứ nó đang soi"
# (`docs/framework/quality-supplements-group2.md` §"Sổ trần cho LỐI THOÁT khỏi cổng coverage").
# Nguy hiểm của chặn oan không phải là phiền: nó dạy người ta gõ ALLOW_DANGEROUS_GIT=1 thành phản
# xạ, và lúc đó hàng rào không còn chặn được ca thật.
#
# CẨN TRỌNG khi sửa hàm dưới: bỏ NHẦM một dòng LÀ LỆNH thì hàng rào để lọt — hỏng theo chiều nguy
# hiểm, không phải chiều phiền. Bản đầu của chính lần sửa này dùng `<<-?[[:space:]]*DELIM`, và
# `echo "a << b"` khớp thành heredoc với delimiter `b` → mọi dòng SAU đó bị nuốt, nên
# `git reset --hard` ở dòng kế KHÔNG bị chặn (đo được, không phải suy đoán). Vì thế: KHÔNG cho phép
# khoảng trắng giữa `<<` và delimiter. Ca đó nay là một ca chặn bắt buộc ở `test-hooks-gate.sh` mục 7.
#
# GIỚI HẠN CÒN LẠI (nói ra, không giấu):
#   - dữ liệu KHÔNG nháy và KHÔNG heredoc vẫn bị quét — `git push -f origin claude/x && echo main`
#     vẫn chặn oan. Sửa hẳn cần tách lệnh theo `&&`/`;`/`|` rồi chỉ soi segment bắt đầu bằng `git`;
#     chưa làm vì phạm vi rộng hơn hẳn và chưa có sự cố thật.
#   - `cat << EOF` (có khoảng trắng — POSIX cho phép) không được nhận là heredoc nữa, nên thân nó
#     vẫn bị quét → có thể chặn oan. Đây là đánh đổi CỐ Ý: chặn oan thì người dùng thấy ngay và nói,
#     còn để lọt thì không ai biết. Chọn chiều an toàn.
# \047 = nháy đơn, \042 = nháy kép (escape bát phân của awk). Dùng chúng thay vì viết nháy thật để
# CẢ chương trình awk nằm gọn trong một cặp nháy đơn của shell — không có chỗ nào phải thoát nháy
# lồng nhau, thứ vừa khó đọc vừa dễ hỏng lặng lẽ khi ai đó sửa.
strip_heredoc_bodies() {
  awk '
    BEGIN { delim = "" }
    {
      if (delim != "") { if ($0 == delim) { delim = "" } ; next }
      if (match($0, /<<-?[\047\042]?[A-Za-z_][A-Za-z0-9_]*[\047\042]?/)) {
        d = substr($0, RSTART, RLENGTH)
        sub(/^<<-?/, "", d)
        gsub(/[\047\042]/, "", d)
        delim = d
      }
      print
    }'
}

# Bỏ phần TRONG DẤU NHÁY (đơn và kép) — dạng 1 ở trên.
strip_quoted() {
  sed "s/'[^']*'//g; s/\"[^\"]*\"//g"
}
