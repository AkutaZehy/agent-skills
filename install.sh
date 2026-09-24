#!/usr/bin/env bash
# agent-skills installer — copies skill folders into per-harness skill dirs, then
# prints the AGENTS.md template blocks for manual pasting. It never edits your files.
#
# Usage:
#   ./install.sh --zcode [--claude] [--dsh]
#   SKILLS="ask-first zcode-wallet" ./install.sh --zcode    # subset
set -euo pipefail
cd "$(dirname "$0")"

SKILLS="${SKILLS:-memory-hygiene ask-first zcode-wallet strategic-coding}"
targets=()

if [ $# -eq 0 ]; then
  echo "usage: ./install.sh [--zcode] [--claude] [--dsh]   (SKILLS=\"a b\" to subset)"
  exit 1
fi
for arg in "$@"; do
  case "$arg" in
    --zcode)  targets+=("$HOME/.zcode/skills") ;;
    --claude) targets+=("$HOME/.claude/skills") ;;
    --dsh)    targets+=("$HOME/.dsh/skills") ;;
    *) echo "unknown flag: $arg" >&2; exit 1 ;;
  esac
done

for t in "${targets[@]}"; do
  mkdir -p "$t"
  for s in $SKILLS; do
    if [ ! -d "skills/$s" ]; then
      echo "skip: skills/$s not found" >&2
      continue
    fi
    cp -r "skills/$s" "$t/"
    echo "installed: $s -> $t/$s"
  done
done

case " $SKILLS " in
  *" zcode-wallet "*)
    echo
    echo "note: repo zcode-wallet SKILL.md is path-agnostic (run 'python zwallet.py')."
    echo "      If your installed copy intentionally pins a local zwallet.py path,"
    echo "      re-install without it: SKILLS=\"memory-hygiene ask-first\" $0"
    echo "      CLI setup: see zcode-wallet/README.md"
    ;;
esac

echo
echo "AGENTS.md template blocks (paste what you need; tool skills need none):"
for s in $SKILLS; do
  if [ -f "templates/$s.md" ]; then
    echo
    echo "=== templates/$s.md ==="
    cat "templates/$s.md"
  fi
done
