#!/usr/bin/env bash
# agent-skills installer — copies skill folders into per-harness skill dirs, then
# prints the AGENTS.md template blocks for manual pasting. Every action is copy/print
# only, with one explicit opt-in: --hooks also installs the ask-first gate into
# ~/.zcode/hooks/ and merges it into ZCode config.json (automatic backup, idempotent).
#
# Usage:
#   ./install.sh --zcode [--claude] [--dsh] [--hooks]
#   SKILLS="ask-first zcode-wallet" ./install.sh --zcode    # subset
set -euo pipefail
cd "$(dirname "$0")"

SKILLS="${SKILLS:-memory-hygiene ask-first zcode-wallet strategic-coding}"
HOOKS=0
targets=()

if [ $# -eq 0 ]; then
  echo "usage: ./install.sh [--zcode] [--claude] [--dsh] [--hooks]   (SKILLS=\"a b\" to subset)"
  exit 1
fi
for arg in "$@"; do
  case "$arg" in
    --zcode)  targets+=("$HOME/.zcode/skills") ;;
    --claude) targets+=("$HOME/.claude/skills") ;;
    --dsh)    targets+=("$HOME/.dsh/skills") ;;
    --hooks)  HOOKS=1 ;;
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
    echo "      CLI setup: see tools/zcode-wallet/README.md"
    ;;
esac

if [ "$HOOKS" = "1" ]; then
  cfg="$HOME/.zcode/cli/config.json"
  hookdir="$HOME/.zcode/hooks"
  if [ ! -f "$cfg" ]; then
    echo "hooks: $cfg not found — skipping (is ZCode installed?)"
  else
    NODE_BIN="$(command -v node || true)"
    if [ -z "$NODE_BIN" ]; then
      echo "hooks: node not found on PATH — install Node.js first" >&2
      exit 1
    fi
    NODE_BIN="$(cygpath -m "$NODE_BIN" 2>/dev/null || echo "$NODE_BIN")"
    if [ -f "$NODE_BIN.exe" ]; then NODE_BIN="$NODE_BIN.exe"; fi
    mkdir -p "$hookdir"
    cp hooks/askfirst-gate.js "$hookdir/askfirst-gate.js"
    echo "installed: hooks/askfirst-gate.js -> $hookdir/"
    node hooks/install-merge.js "$cfg" "$NODE_BIN" "$hookdir/askfirst-gate.js"
    echo "note: hooks take effect in NEW sessions; the running session keeps its old config."
  fi
fi

echo
echo "AGENTS.md template blocks (paste what you need; tool skills need none):"
for s in $SKILLS; do
  if [ -f "templates/$s.md" ]; then
    echo
    echo "=== templates/$s.md ==="
    cat "templates/$s.md"
  fi
done
