"""Machine evidence recorded in the protected release decision at scales M and L."""

from __future__ import annotations

import datetime as dt
import hashlib
import re
from collections.abc import Callable
from typing import Any

SIMULATION = "MÁY MÔ PHỎNG"
BOUND = re.compile(r" · MÁY MÔ PHỎNG ([ML]) ([0-9a-f]{64})$")
ROW20 = re.compile(r"^\|[ \t]*20[ \t]*\|[^\n]*$", re.M)
LOCK_ID = re.compile(r"\bA-[0-9]{3,}\b")
EMPTY = {"", "-", "—"}


def _visible_row(text: str, shown: str) -> str:
    rows = [match[0] for match in ROW20.finditer(text)]
    if len(rows) != 1 or ROW20.findall(shown) != rows:
        raise ValueError("cần đúng một dòng 20 hiển thị trong GO-NO-GO")
    return rows[0]


def _digest(row: str) -> str:
    return hashlib.sha256(row.encode()).hexdigest()


def simulate(
    text: str, shown: str, scale: str, digest: str | None, evidence: dict[str, str], role: str
) -> tuple[str, str]:
    """Amend a pristine row 20 only. Its exact text is bound into the independently protected signature row."""
    old = _visible_row(text, shown)
    cells = [s.strip() for s in old.strip("|").split("|")]
    if len(cells) != 7 or cells[3] not in EMPTY:
        raise ValueError("dòng 20 đã có kết quả của người hoặc sai mẫu")
    if cells[5] not in EMPTY | {"<bản/URL đã thử, ngày>"} or cells[6] not in EMPTY | {"<tên · ngày — bắt buộc>"}:
        raise ValueError("dòng 20 đã có kết quả của người")
    locks = sorted(set(LOCK_ID.findall(evidence["acceptance_lock"])))
    if not locks or not re.fullmatch("[a-f0-9]{64}", digest or "") or not evidence["rollback"].strip():
        raise ValueError("thiếu ID bộ nghiệm thu, digest dev hoặc bằng chứng rollback")
    rollback = " ".join(evidence["rollback"].replace("|", "¦").split())
    cells[3:] = [
        SIMULATION,
        "faithful-fixture",
        f"{', '.join(locks)} · dev {digest} · rollback PASS {rollback}",
        "chưa có người dùng thật dùng thử",
    ]
    if scale == "L":
        cells[5] += " · lỗi lọt đã đo trong 14 ngày UTC: 0"
    row = "| " + " | ".join(cells) + " |"
    return text.replace(old, row, 1), f"{role} · {SIMULATION} {scale} {_digest(row)}"


def verify_simulation(text: str, shown: str, role: str, scale: str) -> bool:
    match = BOUND.search(role)
    if not match or match[1] != scale:
        return False
    try:
        return _digest(_visible_row(text, shown)) == match[2]
    except ValueError:
        return False


def _audit_attributions(line: str) -> set[tuple[str, int]]:
    cells = [s.strip() for s in line.strip("|").split("|")]
    if len(cells) < 3 or not re.fullmatch(r"AUD-[A-Z]+-[0-9]+", cells[0]) or cells[1] not in {"🔴", "🟠"}:
        return set()
    return {(cells[0], int(n)) for n in re.findall(r"\bdo #([1-9][0-9]*)\b", line)}


def _scanned(line: str, start: dt.datetime, end: dt.datetime) -> bool:
    cells = [s.strip() for s in line.strip("|").split("|")]
    if len(cells) <= 5 or not cells[0].isdigit() or cells[3] not in {"đã quét", "rút gọn"}:
        return False
    try:
        day = dt.date.fromisoformat(cells[5])
    except ValueError:
        return False
    return start.date() <= day <= end.date() and bool(re.fullmatch("[a-f0-9]{40}|[a-f0-9]{64}", cells[4]))


def audit_window(patch: str, start: dt.datetime, end: dt.datetime) -> set[int] | None:
    """Only newly attributed findings count. Editing or closing the same row does not create another escape."""
    issues: set[int] = set()
    scanned = False
    for commit in patch.split("\x1e"):
        added: set[tuple[str, int]] = set()
        deleted: set[tuple[str, int]] = set()
        for line in commit.splitlines():
            if line.startswith("+|"):
                added.update(_audit_attributions(line[1:]))
                scanned |= _scanned(line[1:], start, end)
            elif line.startswith("-|"):
                deleted.update(_audit_attributions(line[1:]))
        issues.update(n for _, n in added - deleted)
    return issues if scanned else None


def _originals(repo: str, entry: dict[str, Any], get: Callable[[str], Any], revert: re.Pattern[str]) -> set[int]:
    body = entry.get("body") or ""
    numbers = {int(n) for n in re.findall(r"\breverts?\s+#([1-9][0-9]*)\b", body, re.I)}
    for sha in re.findall(r"\breverts?\s+(?:commit\s+)?([a-f0-9]{7,64})\b", body, re.I):
        related = get(f"repos/{repo}/commits/{sha}/pulls")
        if not isinstance(related, list) or len(related) != 1:
            raise ValueError("không đối chiếu được PR của commit revert")
        numbers.add(related[0]["number"])
    if not numbers:
        raise ValueError("PR revert chưa chỉ rõ PR/commit gốc")
    original: set[int] = set()
    for n in numbers:
        pr = get(f"repos/{repo}/pulls/{n}")
        if (
            not isinstance(pr, dict)
            or pr.get("number") != n
            or not pr.get("merged_at")
            or not isinstance(pr.get("title"), str)
        ):
            raise ValueError("không xác minh được PR gốc của revert")
        if not revert.match(pr["title"]):
            original.add(n)
    return original


def escaped_window(
    repo: str, get: Callable[[str], Any], revert: re.Pattern[str], patch: str, start: dt.datetime, end: dt.datetime
) -> list[int] | None:
    found = audit_window(patch, start, end)
    if found is None or not repo:
        return None
    for page in range(1, 51):
        listing = get(f"repos/{repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page={page}")
        if not isinstance(listing, list) or len(listing) > 100:
            raise ValueError("không đọc được trang GitHub")
        for pr in listing:
            if not isinstance(pr, dict) or not isinstance(pr.get("title"), str):
                raise ValueError("dữ liệu PR thiếu trường")
            updated = dt.datetime.fromisoformat(pr["updated_at"])
            if updated < start:
                return sorted(found)
            merged = pr["merged_at"]
            if merged and start <= dt.datetime.fromisoformat(merged) <= end and revert.match(pr["title"]):
                found.update(_originals(repo, pr, get, revert))
        if len(listing) < 100:
            return sorted(found)
    raise ValueError("ngưỡng phân trang GitHub, chưa đọc hết 14 ngày")
