#!/usr/bin/env python3
"""ctx: compact batch read/search/run helper.

Designed for ZCode sessions: one CLI call does the bulk work and prints a
compact digest; full output is written under .ctx/logs for later paging.

Local tool only. All paths are supplied explicitly by the caller. Commands are
executed as an argv list (shell=False); use Bash directly for pipelines.
"""
from __future__ import annotations

import argparse
import fnmatch
import os
import re
import subprocess
import sys
import time
from pathlib import Path

SKIP_DIRS = {
    ".git", ".hg", ".svn", "node_modules", ".venv", "venv", "env",
    "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
    ".next", ".nuxt", "dist", "build", ".ctx", ".idea", ".vscode",
}
MAX_CONSOLE = 12000


def norm(arg: str) -> Path:
    """Accept Git Bash /c/... paths and ~ expansion."""
    s = str(arg).strip()
    m = re.match(r"^/([A-Za-z])/(.*)$", s)
    if m:
        s = f"{m.group(1).upper()}:/{m.group(2)}"
    return Path(s).expanduser()


def make_log(log_dir: str | None, slug: str) -> Path:
    base = norm(log_dir) if log_dir else (Path.cwd() / ".ctx" / "logs")
    base.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    return base / f"{stamp}-{slug}.log"


def is_binary(path: Path) -> bool:
    try:
        with path.open("rb") as f:
            return b"\x00" in f.read(4096)
    except OSError:
        return True


def iter_files(roots, includes, excludes, max_bytes):
    for root in roots:
        p = norm(root)
        if p.is_file():
            yield p
            continue
        if not p.exists():
            continue
        for dirpath, dirnames, filenames in os.walk(p):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for name in filenames:
                if includes and not any(fnmatch.fnmatch(name, pat) for pat in includes):
                    continue
                if excludes and any(fnmatch.fnmatch(name, pat) for pat in excludes):
                    continue
                fp = Path(dirpath) / name
                try:
                    if fp.stat().st_size > max_bytes:
                        continue
                except OSError:
                    continue
                if is_binary(fp):
                    continue
                yield fp


def emit(lines, limit=MAX_CONSOLE):
    text = "\n".join(lines)
    if len(text) <= limit:
        print(text)
    else:
        print(text[:limit])
        print("... [console truncated; full output in log]")


def write_log(path: Path, lines):
    with path.open("w", encoding="utf-8", errors="replace") as f:
        f.write("\n".join(lines))


def cmd_scan(args):
    flags = 0 if args.case_sensitive else re.IGNORECASE
    try:
        pattern = re.compile(args.pattern, flags)
    except re.error as e:
        print(f"ctx scan: invalid regex: {e}", file=sys.stderr)
        return 2

    roots = args.roots or ["."]
    includes = args.include or []
    excludes = args.exclude or []
    log = make_log(args.log_dir, "scan")
    log_lines = [
        "# ctx scan",
        f"# time: {time.strftime('%Y-%m-%d %H:%M:%S')}",
        f"# cwd: {Path.cwd()}",
        f"# roots: {roots}",
        f"# pattern: {args.pattern}",
        f"# include: {includes}  exclude: {excludes}",
        "",
    ]
    console = []
    files = 0
    hit_files = 0
    hits = 0
    for fp in iter_files(roots, includes, excludes, args.max_file_bytes):
        files += 1
        try:
            raw = fp.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        file_hit = False
        for idx, line in enumerate(raw):
            if not pattern.search(line):
                continue
            hits += 1
            file_hit = True
            start = max(0, idx - args.context)
            end = min(len(raw), idx + args.context + 1)
            log_lines.append(f"== {fp}:{idx + 1} ==")
            for j in range(start, end):
                log_lines.append(f"{j + 1}: {raw[j]}")
            log_lines.append("")
            if len(console) < args.max_hits:
                console.append(f"{fp}:{idx + 1}: {line.strip()[:240]}")
        if file_hit:
            hit_files += 1
    write_log(log, log_lines)
    header = (
        f"ctx scan: files={files} matched={hit_files} hits={hits} "
        f"limit={args.max_hits} | log={log}"
    )
    out = [header] + console
    if hits > len(console):
        out.append(f"... {hits - len(console)} more hits in log")
    emit(out)
    return 0


def cmd_read(args):
    log = make_log(args.log_dir, "read")
    log_lines = [f"# ctx read {args.files}", ""]
    console = []
    total_bytes = 0
    for name in args.files:
        fp = norm(name)
        if not fp.is_file():
            console.append(f"== {fp} == MISSING")
            continue
        try:
            data = fp.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            console.append(f"== {fp} == ERROR {e}")
            continue
        lines = data.splitlines()
        total_bytes += len(data.encode("utf-8", errors="replace"))
        log_lines.append(f"===== {fp} ({len(lines)} lines) =====")
        log_lines.extend(lines)
        log_lines.append("")
        head = lines[: args.head]
        tail = lines[-args.tail:] if args.tail and len(lines) > args.head else []
        console.append(f"== {fp} == {len(lines)} lines, {len(data)} chars")
        console.extend(head)
        if tail:
            console.append(f"... [{len(lines) - args.head - args.tail} lines omitted] ...")
            console.extend(tail)
        if len(data) > args.max_chars:
            console.append(f"... [file larger than {args.max_chars} chars; full text in log]")
    write_log(log, log_lines)
    emit([f"ctx read: files={len(args.files)} bytes={total_bytes} | log={log}"] + console)
    return 0


def cmd_run(args):
    cmd = list(args.cmd)
    if cmd and cmd[0] == "--":
        cmd = cmd[1:]
    if not cmd:
        print("ctx run: no command (use: ctx run -- <cmd...>)", file=sys.stderr)
        return 2
    log = make_log(args.log_dir, "run")
    started = time.time()
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=args.timeout,
            cwd=str(norm(args.cwd)) if args.cwd else None,
        )
        out = proc.stdout or ""
        err = proc.stderr or ""
        code = proc.returncode
    except subprocess.TimeoutExpired as e:
        out = e.stdout if isinstance(e.stdout, str) else ""
        err = e.stderr if isinstance(e.stderr, str) else ""
        code = "TIMEOUT"
    elapsed = time.time() - started
    log_lines = [f"# ctx run {cmd}", f"# exit: {code}", f"# elapsed: {elapsed:.2f}s", "", "## stdout", out, "", "## stderr", err]
    write_log(log, log_lines)
    tail = out.splitlines()[-args.tail:]
    console = [f"ctx run: exit={code} elapsed={elapsed:.2f}s | log={log}"]
    if tail:
        console.append("--- stdout tail ---")
        console.extend(tail)
    if err.strip():
        console.append("--- stderr tail ---")
        console.extend(err.splitlines()[-args.tail:])
    emit(console)
    return 0 if code == 0 else 1


def cmd_page(args):
    fp = norm(args.log)
    if not fp.is_file():
        print(f"ctx page: missing {fp}", file=sys.stderr)
        return 2
    lines = fp.read_text(encoding="utf-8", errors="replace").splitlines()
    if args.grep:
        try:
            pat = re.compile(args.grep, re.IGNORECASE)
        except re.error as e:
            print(f"ctx page: invalid grep: {e}", file=sys.stderr)
            return 2
        lines = [l for l in lines if pat.search(l)]
    start = max(0, args.offset)
    end = min(len(lines), start + args.limit)
    emit([f"ctx page: {fp} lines={len(lines)} showing={start}:{end}"] + [f"{i + 1}: {l}" for i, l in enumerate(lines[start:end], start)])
    return 0


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(prog="ctx", description="compact batch helper for ZCode")
    sub = ap.add_subparsers(dest="command", required=True)

    p = sub.add_parser("scan", help="regex scan across many files")
    p.add_argument("pattern")
    p.add_argument("roots", nargs="*")
    p.add_argument("--include", action="append", default=[])
    p.add_argument("--exclude", action="append", default=[])
    p.add_argument("--max-hits", type=int, default=60)
    p.add_argument("--context", type=int, default=0)
    p.add_argument("--max-file-bytes", type=int, default=2_000_000)
    p.add_argument("--case-sensitive", action="store_true")
    p.add_argument("--log-dir")
    p.set_defaults(func=cmd_scan)

    p = sub.add_parser("read", help="preview many files, full text to log")
    p.add_argument("files", nargs="+")
    p.add_argument("--head", type=int, default=20)
    p.add_argument("--tail", type=int, default=10)
    p.add_argument("--max-chars", type=int, default=20000)
    p.add_argument("--log-dir")
    p.set_defaults(func=cmd_read)

    p = sub.add_parser("run", help="run a command, keep full output in log")
    p.add_argument("--cwd")
    p.add_argument("--timeout", type=int, default=600)
    p.add_argument("--tail", type=int, default=30)
    p.add_argument("--log-dir")
    p.add_argument("cmd", nargs=argparse.REMAINDER)
    p.set_defaults(func=cmd_run)

    p = sub.add_parser("page", help="page/grep a stored log")
    p.add_argument("log")
    p.add_argument("--offset", type=int, default=0)
    p.add_argument("--limit", type=int, default=80)
    p.add_argument("--grep")
    p.set_defaults(func=cmd_page)

    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
