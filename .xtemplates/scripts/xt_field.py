"""Validate bounded field evidence and inspect incident actions without running the evidence."""

from __future__ import annotations

import argparse
import ast
import datetime as dt
import json
import math
import re
import sys
from pathlib import Path
from types import ModuleType
from typing import Any, Callable, cast

import xt_release_ops as ops

Doc = dict[str, Any]
MAX = 1024 * 1024
FIELD_NAME = re.compile(r"FIELD-(\d{4}-\d{2}-\d{2})(?:-\d{6}(?:\d{6})?Z?)?\.json\Z")
LABEL = re.compile(r"[\w][\w .:/@+-]{0,95}\Z")
TEST_REF = re.compile(r"`([^`:\s]+)::([^`\n]+)`")


class FieldError(ValueError):
    """Safe validation diagnostic without private data from a monitoring export."""


def label(value: Any) -> str:
    if not isinstance(value, str) or not LABEL.fullmatch(value):
        raise FieldError("nhãn đo không hợp lệ")
    return value


def timestamp(value: Any) -> dt.datetime:
    if not isinstance(value, str) or len(value) > 40:
        raise FieldError("cần thời điểm UTC")
    parsed = dt.datetime.fromisoformat(value)
    if parsed.utcoffset() != dt.timedelta(0):
        raise FieldError("thời điểm phải là UTC")
    return parsed


def number(value: Any) -> int | float:
    if type(value) not in (float, int) or not math.isfinite(value) or value < 0:
        raise FieldError("chỉ số/ngân sách phải là số hữu hạn không âm")
    return cast("int | float", value)


def metric(item: Any) -> tuple[Doc, list[str]]:
    if not isinstance(item, dict):
        raise FieldError("metrics phải chứa object")
    info: Doc = {"name": label(item.get("name"))}
    if "segment" in item:
        info["segment"] = label(item["segment"])
    if "percentile" in item:
        pct = number(item["percentile"])
        if not 0 < pct <= 100:
            raise FieldError("percentile nằm trong (0,100]")
        info["percentile"] = pct
    vals = {k.removeprefix("value_"): number(v) for k, v in item.items() if k.startswith("value_")}
    caps = {k.removeprefix("budget_"): number(v) for k, v in item.items() if k.startswith("budget_")}
    if not vals or caps.keys() - vals.keys() or any(not re.fullmatch(r"[a-z][a-z0-9_]{0,23}", u) for u in vals):
        raise FieldError("thiếu value_<đơn vị> hoặc budget khác đơn vị")
    info.update({"value_" + k: v for k, v in vals.items()})
    info.update({"budget_" + k: v for k, v in caps.items()})
    name = info["name"] + (f" p{info['percentile']:g}" if "percentile" in info else "")
    return info, [f"{name} {vals[k]:g} > {limit:g} {k}" for k, limit in caps.items() if vals[k] > limit]


def normalize(data: Any) -> tuple[Doc, list[str]]:
    if not isinstance(data, dict) or not isinstance(data.get("window"), dict):
        raise FieldError("thiếu window")
    if not data.get("source") or not data.get("exported_by"):
        raise FieldError("thiếu source/exported_by")
    exported = timestamp(data.get("exported_at"))
    start = timestamp(data["window"].get("from"))
    end = timestamp(data["window"].get("to"))
    now = dt.datetime.now(dt.timezone.utc)
    if not start < end <= exported <= now or min(end, exported) < now - dt.timedelta(days=30):
        raise FieldError("cửa sổ sai thứ tự, trong tương lai hoặc quá 30 ngày")
    rows = data.get("metrics")
    if not isinstance(rows, list) or not 1 <= len(rows) <= 1024:
        raise FieldError("metrics cần từ 1 đến 1024 mục")
    output: Doc = {
        "source": label(data.get("source")),
        "exported_by": label(data.get("exported_by")),
        "exported_at": exported.isoformat(),
        "window": {"from": start.isoformat(), "to": end.isoformat()},
        "metrics": [],
    }
    breaches = []
    for item in rows:
        row, reasons = metric(item)
        output["metrics"].append(row)
        breaches.extend(reasons)
    return output, breaches


def read_field(raw: bytes) -> Any:
    if len(raw) > MAX:
        raise FieldError("FIELD quá 1 MiB")
    try:
        return json.loads(raw.decode("utf-8"))
    except (ValueError, RecursionError) as exc:
        raise FieldError("JSON/UTF-8 không hợp lệ") from exc


def from_ops(core: ModuleType, base: Path, data: Doc) -> Doc:
    cfg = core._xt_keys(base)
    env = cfg.get("field_env", "prod")
    digest = data.get("digest")
    if (
        data.get("env") != env
        or not isinstance(digest, str)
        or not core.DEPLOY_ENV_NAME.fullmatch(env)
        or not core._deploy_sha256(digest)
    ):
        raise FieldError("env/digest không hợp lệ")
    deployed = ops.confirmed_after(core, base, env, digest)
    win = ops.field_window(core, data, deployed, 720)
    metrics = ops.field_metrics(data)
    p95 = number(float(cfg["field_max_p95_ms"]))
    pct = number(float(cfg["field_max_error_pct"]))
    if p95 == 0 or pct > 100:
        raise FieldError("ngưỡng SLO không hợp lệ")
    return {
        "observation": {k: data[k] for k in ("env", "digest", "requests", "errors", "p95_ms")},
        "source": data.get("source"),
        "exported_by": data.get("exported_by", "field-export"),
        "exported_at": win["exported_at"],
        "window": {"from": win["started"], "to": win["finished"]},
        "metrics": [
            {"name": "latency", "percentile": 95, "value_ms": metrics["p95_ms"], "budget_ms": p95},
            {"name": "error_rate", "value_pct": metrics["error_pct"], "budget_pct": pct},
        ],
    }


def field_check(core: ModuleType, args: argparse.Namespace) -> int:
    try:
        if args.file == "-":
            raw = sys.stdin.buffer.read(MAX + 1)
        else:
            with Path(args.file).open("rb") as stream:
                raw = stream.read(MAX + 1)
        output, breaches = checked_output(core, core.loop_root(core.project_dir()), raw)
    except FieldError as exc:
        print("FIELD không hợp lệ:", exc, file=sys.stderr)
        return 2
    except (OSError, ValueError, TypeError, KeyError, OverflowError, core.DeployError):
        print("FIELD không hợp lệ: kiểm file, cấu hình ngân sách và receipt.", file=sys.stderr)
        return 2
    if args.normalize:
        print(json.dumps(output, ensure_ascii=False))
    elif args.json:
        print(json.dumps({"verdict": "regression" if breaches else "pass", "breaches": breaches}, ensure_ascii=False))
    else:
        print("\n".join(breaches) if breaches else "Đạt ngân sách đã khai.")
    return int(bool(breaches))


def default_commit(git: Callable[..., str]) -> str:
    remote = git("config", "--local", "--no-includes", "--get", "remote.origin.url")
    if remote:
        default = git("symbolic-ref", "--quiet", "refs/remotes/origin/HEAD")
        refs = (default,) if default else ("refs/remotes/origin/main", "refs/remotes/origin/master")
    else:
        refs = ("refs/heads/main", "refs/heads/master")
    return next((sha for ref in refs if ref and (sha := git("rev-parse", "--verify", ref + "^{commit}"))), "")


def field_blobs(rows: str) -> list[tuple[str, str, str]]:
    candidates = []
    for item in rows.rstrip("\0").split("\0"):
        meta, sep, path = item.partition("\t")
        match = FIELD_NAME.fullmatch(Path(path).name)
        bits = meta.split()
        if sep and match and len(bits) == 4 and bits[0] == "100644" and bits[3].isdigit() and int(bits[3]) <= MAX:
            candidates.append((match[1], bits[2], path))
    return candidates


def committed_field(core: ModuleType, base: Path, plan: str) -> Doc:
    """Use committed default-branch blobs only. next-step stays offline."""
    git_env = core._go_git_env()

    def git(*args: str) -> str:
        res = core._git(base, *args, env=git_env)
        return str(res.stdout).strip() if res.returncode == 0 else ""

    commit = default_commit(git)
    if not commit:
        return {}
    rows = git("ls-tree", "-l", "-z", commit, "--", "docs/ops/")
    candidates = field_blobs(rows)
    if not candidates:
        return {}
    newest = max(v[0] for v in candidates)
    good = []
    for day, blob, path in candidates:
        if day != newest:
            continue
        try:
            doc, _ = normalize(read_field(git("cat-file", "blob", blob).encode()))
            if doc["exported_at"][:10] != day:
                raise ValueError
            good.append((doc["exported_at"], path, doc))
        except (ValueError, TypeError, OverflowError):
            return {}
    _, path, doc = max(good, key=lambda v: (timestamp(v[0]), v[1]))
    return uncovered(core, base, plan, path, doc)


def uncovered(core: ModuleType, base: Path, plan: str, path: str, doc: Doc) -> Doc:
    try:
        tasks = core.parse_plan(base / plan) if plan else []
    except (OSError, ValueError):
        tasks = []
    unmet = []
    for row in doc["metrics"]:
        _, alerts = metric(row)
        seen = any(
            re.search(r"(?<!\w)" + re.escape(row["name"]) + r"(?!\w)", str(t.get("rest", "")).casefold(), re.I)
            and (t["state"] != "x" or path in t.get("rest", ""))
            for t in tasks
        )
        if not seen:
            unmet.extend(alerts)
    return {"field": {"source": path, "breaches": unmet}} if unmet else {}


def checked_output(core: ModuleType, base: Path, raw: bytes) -> tuple[Doc, list[str]]:
    data = read_field(raw)
    if not isinstance(data, dict):
        raise FieldError("thiếu window")
    if "observation" in data:
        obs = data["observation"]
        if not isinstance(obs, dict) or not isinstance(data.get("window"), dict):
            raise FieldError("thiếu window")
        data = {
            **data,
            **{k: obs.get(k) for k in ("env", "digest", "requests", "errors", "p95_ms")},
            "started": data["window"].get("from"),
            "finished": data["window"].get("to"),
        }
    if "digest" not in data:
        return normalize(data)
    bound = from_ops(core, base, data)
    doc, breaches = normalize(bound)
    doc["observation"] = bound["observation"]
    return doc, breaches


def export(core: ModuleType, args: argparse.Namespace) -> int:
    import subprocess
    import tempfile

    base = core.loop_root(core.project_dir())
    try:
        command = core._xt_keys(base).get("field_export", "")
        if not command.strip():
            return 3
        if core.gate_noop(command) or core.guard_block(command, base):
            raise ValueError
        with tempfile.TemporaryFile() as out:
            job = subprocess.run(
                ["bash", "-o", "pipefail", "-c", command],
                cwd=base,
                stdout=out,
                stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL,
                check=False,
                timeout=120,
            )
            if job.returncode:
                raise ValueError
            out.seek(0)
            doc, _ = checked_output(core, base, out.read(MAX + 1))
        print(json.dumps(doc, ensure_ascii=False))
        return 0
    except (OSError, ValueError, TypeError, KeyError, OverflowError, subprocess.TimeoutExpired, core.DeployError):
        print("field_export hỏng hoặc số liệu không hợp lệ.", file=sys.stderr)
        return 2


def test_exists(root: Path, ref: str, name: str) -> bool:
    path = (root / ref).resolve()
    if (
        Path(ref).is_absolute()
        or not path.is_relative_to(root)
        or not path.is_file()
        or path.stat().st_size > MAX
        or ".git" in path.relative_to(root).parts
    ):
        return False
    text = path.read_text(encoding="utf-8")
    if path.suffix == ".py":
        try:
            tree = ast.parse(text)
        except SyntaxError:
            return False
        sep = name.replace("::", ".").split(".")
        nodes = (
            tree.body
            if len(sep) == 1
            else [
                child
                for parent in tree.body
                if isinstance(parent, ast.ClassDef) and parent.name == sep[0]
                for child in parent.body
            ]
        )
        return (
            len(sep) <= 2
            and sep[-1].startswith("test")
            and any(isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == sep[-1] for n in nodes)
        )
    # Consume comment and string tokens before declarations so examples cannot count.
    token = r"""//[^\n]*|/\*[\s\S]*?\*/|`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|"""
    if path.suffix in {".ts", ".tsx", ".js", ".mjs", ".jsx", ".cjs"}:
        declaration = r"""(?m:^\s*(?:it|test)(?:\.concurrent)?\s*\(\s*(['"])([^'"\n]+)\1\s*,)"""
        return any(m[2] == name for m in re.finditer(token + declaration, text))
    if path.name.endswith("_test.go") and re.fullmatch(r"Test[A-Z0-9_]\w*", name):
        declaration = r"(?m:^func\s+(" + re.escape(name) + r")\s*\()"
        return any(m[1] == name for m in re.finditer(token + declaration, text))
    return False


def corrective_actions(text: str) -> list[tuple[int, str, str]]:
    rows = []
    section = False
    kind = -1
    for line_no, line in enumerate(text.splitlines(), 1):
        if line.startswith("## "):
            section = re.match(r"^##\s+(?:6\.\s*)?Hành động\b", line, re.I) is not None
            kind = -1
            continue
        if not section or not line.strip().startswith("|"):
            continue
        cells = [x.strip() for x in line.strip().strip("|").split("|")]
        if kind < 0:
            kind = next((i for i, c in enumerate(cells) if c.casefold().startswith("loại")), -1)
            continue
        if not cells or all(re.fullmatch("[: -]*", c) for c in cells):
            continue
        if kind >= len(cells) or cells[kind].casefold() not in {
            "vá",
            "phòng ngừa",
            "phòng tái diễn",
            "phát hiện",
            "quy trình",
        }:
            raise ValueError
        rows.append((line_no, cells[kind].casefold(), line))
    if not rows:
        raise FieldError("Thiếu bảng hành động theo mẫu post-mortem")
    return rows


def incident(core: ModuleType, args: argparse.Namespace) -> int:
    root = core.loop_root(core.project_dir())
    try:
        file = (root / args.file).resolve()
        if not file.is_relative_to(root) or file.stat().st_size > MAX:
            raise ValueError
        view = core._ShownView()
        text = "\n".join(view.shown(line) or "" for line in file.read_text(encoding="utf-8-sig").splitlines())
        errors = []
        for line, kind, row in corrective_actions(text):
            if kind not in ("phòng ngừa", "phòng tái diễn"):
                continue
            reason = re.search(r"không kiểm thử được\s*[—–:-]\s*([^|]+)", row, re.I)
            exempt = (
                reason
                and reason[1].strip(" `.,…-")
                and "<" not in reason[1]
                and not re.fullmatch(r"\s*lý do\s*", reason[1], re.I)
            )
            if not exempt and not any(test_exists(root, m[1], m[2]) for m in TEST_REF.finditer(row)):
                errors.append(line)
        print(
            json.dumps({"missing_lines": errors}, ensure_ascii=False)
            if args.json
            else (
                "Hành động phòng ngừa thiếu ca kiểm thử ở dòng " + ", ".join(map(str, errors))
                if errors
                else "Mọi hành động phòng ngừa đã có bằng chứng."
            )
        )
        return int(bool(errors))
    except (OSError, ValueError, TypeError):
        print("Không đọc được bảng hành động post-mortem.", file=sys.stderr)
        return 2
