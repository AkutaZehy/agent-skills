#!/usr/bin/env bash
# publish-privacy-alert scanner — profile-driven pre-publish privacy scan.
# usage: scan.sh <profile> <target>...
# exit: 0 = clean, 1 = hits found, 2 = usage, 3 = profile missing.
# Profile format: `re:<ERE>` regex deny | `allow:<literal>` pre-approved |
#                 other non-empty non-# lines = literal deny | `#` comments.
set -uo pipefail
[ $# -ge 2 ] || { echo "usage: scan.sh <profile> <target>..." >&2; exit 2; }
PROFILE=$1; shift
if [ ! -f "$PROFILE" ]; then
  echo "profile missing: $PROFILE — build it with the user first (画像缺失即阻塞)" >&2
  exit 3
fi

tmp=$(mktemp -d) || exit 3
trap 'rm -rf "$tmp"' EXIT
lit="$tmp/lit"; reg="$tmp/reg"; allow="$tmp/allow"; hits="$tmp/hits"
: > "$lit"; : > "$reg"; : > "$allow"

# builtin generic patterns (secret shapes; keep minimal, profile carries specifics)
cat >> "$reg" <<'BUILTIN'
sk-[A-Za-z0-9]{16,}
-----BEGIN [A-Z ]*PRIVATE KEY-----
BUILTIN

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ''|'#'*) ;;
    're:'*) printf '%s\n' "${line#re:}" >> "$reg" ;;
    'allow:'*) printf '%s\n' "${line#allow:}" >> "$allow" ;;
    *) printf '%s\n' "$line" >> "$lit" ;;
  esac
done < "$PROFILE"

rc=0
for t in "$@"; do
  if [ ! -e "$t" ]; then
    echo "skip: no such target $t" >&2
    continue
  fi
  # .git = local internals (author email lives in commit metadata by design);
  # node_modules = dependency trees. Neither is the publish surface.
  {
    if [ -s "$lit" ]; then grep -rnF --exclude-dir=.git --exclude-dir=node_modules -f "$lit" "$t" 2>/dev/null; fi
    if [ -s "$reg" ]; then grep -rnE --exclude-dir=.git --exclude-dir=node_modules -f "$reg" "$t" 2>/dev/null; fi
  } > "$hits" || true

  if [ -s "$allow" ] && [ -s "$hits" ]; then
    grep -vF -f "$allow" "$hits" > "$hits.f" || true
    mv "$hits.f" "$hits"
  fi

  if [ -s "$hits" ]; then
    rc=1
    echo "== hits in $t =="
    cat "$hits"
  fi
done

if [ $rc -eq 0 ]; then
  echo "clean: no deny-list hits (semantic review still required — see SKILL.md)"
fi
exit $rc
