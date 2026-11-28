---
name: ctx-batch
version: "1.0.0"
description: Use when a task requires reading, searching, or executing across many files, directories, or long logs. Runs one batched CLI call and returns a compact digest while storing full output under .ctx/logs for paging. Triggers include 批量读文件、跨目录搜索、扫日志、多文件 grep、批量命令.
---

# ctx-batch

One CLI call does the bulk work; the model sees only a compact digest.

## When to use

- Expected to read ≥5 files or cross ≥3 directories.
- Scanning a large log/tree for a pattern.
- Running several read-only commands whose full output is not needed.
- A single tool result would otherwise be thousands of lines.

Do not use for a single file or a quick one-line grep; use Read/Grep/Bash directly.

## Commands

Script: `scripts/ctx.py` in this skill directory. ZCode users typically put it on PATH as `~/.zcode/bin/ctx.py`; the examples below use that path — substitute your own install path.

```bash
# scan many files, show first 60 hits, full hits to .ctx/logs
python ~/.zcode/bin/ctx.py scan "toolAllowlist" ~/.zcode --include "*.json" --include "*.md" --max-hits 60 --context 1

# preview many files; full text goes to the log
python ~/.zcode/bin/ctx.py read file1.py file2.py --head 30 --tail 15

# run a command as argv (no shell); tail is printed, full stdout/stderr logged
python ~/.zcode/bin/ctx.py run -- python script.py --flag value

# page or grep the stored log
python ~/.zcode/bin/ctx.py page <log-path> --offset 0 --limit 120
python ~/.zcode/bin/ctx.py page <log-path> --grep "ERROR|Traceback"
```

Logs default to `./.ctx/logs/`; override with `--log-dir`.

## Rules

- Use absolute paths; do not prefix commands with `cd` (cwd persists).
- `ctx run` takes an argv list and executes with `shell=False`. For pipes/redirection, use Bash directly.
- Read the digest first; page the log only for the exact lines you need.
- Keep mutations (Edit/Write/rm) in the normal tools so the gate still sees them; `ctx` is for read-only bulk work.
- If the scan is too broad, add `--include`, `--exclude`, or narrow the root instead of raising `--max-hits`.
