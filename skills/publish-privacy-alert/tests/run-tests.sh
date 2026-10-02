#!/usr/bin/env bash
# Self-test for publish-privacy-alert scanner. Public synthetic corpus only —
# no real identifiers. run: tests/run-tests.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCAN="$ROOT/scripts/scan.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cat > "$tmp/profile" <<'PROFILE'
# deny literals
C:\Users\alice
D:\private\alice-project
# deny regex
re:token[=: ]+[A-Za-z0-9]{12,}
# allow (pre-approved)
allow:C:\demo
allow:AkutaZehy
PROFILE

cat > "$tmp/leak.md" <<'LEAK'
config lives at C:\Users\alice\notes.txt
mirror repo at D:\private\alice-project
token=ALICE123456789012 abcd
approved placeholder: C:\demo\readme.md
approved identity: github.com/AkutaZehy
LEAK

cat > "$tmp/clean.md" <<'CLEAN'
use relative path docs/DESIGN.md
demo path C:\demo\readme.md is pre-approved
identity github.com/AkutaZehy is pre-approved
CLEAN

fail=0

bash "$SCAN" "$tmp/profile" "$tmp/leak.md" > "$tmp/out1" 2>&1
if [ $? -eq 1 ] && grep -q "alice" "$tmp/out1" \
   && grep -q "ALICE123456789012" "$tmp/out1" \
   && ! grep -q "C:.demo" "$tmp/out1" \
   && ! grep -q "AkutaZehy" "$tmp/out1"; then
  echo "pass: leak file detected, allow-list downgraded"
else
  echo "FAIL: leak detection"; cat "$tmp/out1"; fail=1
fi

bash "$SCAN" "$tmp/profile" "$tmp/clean.md" > "$tmp/out2" 2>&1
if [ $? -eq 0 ]; then
  echo "pass: clean file exits 0"
else
  echo "FAIL: clean file flagged"; cat "$tmp/out2"; fail=1
fi

bash "$SCAN" "$tmp/missing-profile" "$tmp/clean.md" > /dev/null 2>&1
if [ $? -eq 3 ]; then
  echo "pass: missing profile blocked (exit 3)"
else
  echo "FAIL: missing profile not blocked"; fail=1
fi

exit $fail
