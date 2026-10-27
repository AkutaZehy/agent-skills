#!/usr/bin/env python3
"""Render MEMORY.md from memory frontmatter.

The index carries only the always-read tier (`type: feedback` and `type: user`).
Every other memory stays out of the index and is found by grep over the bucket.

usage: memory-index.py [--dir PATH] [--check] [--dry-run]
exit:  0 ok / 1 drift (--check) / 2 usage or IO error

Contract: the generator is the only writer of MEMORY.md. To change a line,
edit the memory file's `title` or `description`, then regenerate.
"""

import argparse
import os
import re
import sys

DEFAULT_ROOT = os.path.expanduser("~/.zcode/cli/memories/projects")
ALWAYS_READ = ("feedback", "user")
TITLE_MAX = 22
HOOK_MAX = 48


def default_dir():
    """Locate the global memory bucket by prefix; callers pass --dir elsewhere."""
    try:
        names = sorted(name for name in os.listdir(DEFAULT_ROOT)
                       if name.startswith("default-"))
    except OSError:
        return None
    return os.path.join(DEFAULT_ROOT, names[0], "memory") if names else None


def parse_frontmatter(path):
    """Return the fields the index needs, or None when the file is unusable."""
    try:
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
    except OSError as error:
        print("warn: cannot read %s: %s" % (os.path.basename(path), error),
              file=sys.stderr)
        return None
    match = re.match(r"^---\r?\n(.*?)\r?\n---", text, re.S)
    if not match:
        print("warn: no frontmatter: %s" % os.path.basename(path), file=sys.stderr)
        return None
    frontmatter = match.group(1)

    def field(name):
        hit = re.search(r"^\s*%s:\s*(.+)$" % name, frontmatter, re.M)
        return hit.group(1).strip().strip('"').strip("'") if hit else ""

    return {
        "name": field("name") or os.path.basename(path)[:-3],
        "type": field("type"),
        "title": field("title"),
        "description": field("description"),
        "status": field("status"),
    }


def render(directory):
    entries = []
    skipped = 0
    for filename in sorted(os.listdir(directory)):
        if not filename.endswith(".md") or filename == "MEMORY.md":
            continue
        fields = parse_frontmatter(os.path.join(directory, filename))
        if fields is None:
            skipped += 1
            continue
        if fields["type"] not in ALWAYS_READ or fields["status"] == "closed":
            continue
        label = (fields["title"] or fields["name"])[:TITLE_MAX]
        entries.append("- [%s](%s)" % (label, filename))

    lines = [
        "# 记忆索引（生成物，勿手改）",
        "",
        "由 `tools/memory-index.py` 从 frontmatter 生成，只收 `type: feedback` 与 `type: user`。",
        "",
        "## 必读（%d 条）" % len(entries),
        "",
    ]
    lines.extend(entries or ["- （无）"])
    lines.extend([
        "",
        "> 其余条目按需检索：`grep -rli --include='*.md' -E '关键词1|关键词2' <memory 目录>`。",
        "> 改记忆改文件本身（`title` / `description`）再重跑生成器，索引不是手写入口。",    ])
    if skipped:
        lines.append("> 本目录另有 %d 个文件缺 frontmatter，未纳入索引。" % skipped)
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", default=None)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    directory = args.dir or default_dir()
    if directory is None:
        print("error: no global memory bucket found; pass --dir", file=sys.stderr)
        return 2

    if not os.path.isdir(directory):
        print("error: not a directory: %s" % directory, file=sys.stderr)
        return 2

    target = os.path.join(directory, "MEMORY.md")
    rendered = render(directory)
    try:
        with open(target, encoding="utf-8") as handle:
            current = handle.read()
    except FileNotFoundError:
        current = ""

    if args.check:
        if current == rendered:
            print("index up to date (%d chars)" % len(rendered))
            return 0
        print("index drifted: run memory-index.py to rebuild", file=sys.stderr)
        return 1
    if args.dry_run:
        sys.stdout.write(rendered)
        return 0

    with open(target, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(rendered)
    print("wrote %s (%d chars)" % (target, len(rendered)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
