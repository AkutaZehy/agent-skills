#!/usr/bin/env bash
# Self-test for publish-privacy-alert scanner. Public synthetic corpus only —
# no real identifiers. run: tests/run-tests.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCAN="$ROOT/scripts/scan.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail=0
check() { # desc expected actual
  if [ "$2" -eq "$3" ]; then echo "pass: $1"; else echo "FAIL: $1 (expected exit $2, got $3)"; fail=1; fi
}

cat > "$tmp/profile" <<'PROFILE'
# deny literals
C:\Users\alice\notes.txt
D:\private\alice-project
# deny regex
re:token[=: ]+[A-Za-z0-9]{12,}
# allow (pre-approved)
allow:C:\demo
allow:example-user
PROFILE

cat > "$tmp/leak.md" <<'LEAK'
config lives at C:\Users\alice\notes.txt
mirror repo at D:\private\alice-project
token=ALICE123456789012 abcd
approved placeholder: C:\demo\readme.md
approved identity: example-user
co-occurrence: token=ALICE123456789012 abcd next to C:\demo\readme.md
LEAK

cat > "$tmp/clean.md" <<'CLEAN'
use relative path docs/DESIGN.md
demo path C:\demo\readme.md is pre-approved
identity example-user is pre-approved
CLEAN

# 1) leak file → HIT(1), allow-candidates tagged, output redacted
bash "$SCAN" "$tmp/profile" "$tmp/leak.md" > "$tmp/o1" 2>&1
check "leak file exits HIT(1)" 1 "$?"
grep -q "\[hit:deny\]" "$tmp/o1" && echo "pass: hits tagged [hit:deny]" || { echo "FAIL: no hit tag"; fail=1; }
grep -q "\[allow-candidate\]" "$tmp/o1" && echo "pass: allow-candidates tagged" || { echo "FAIL: no allow tag"; fail=1; }
if grep -qE "notes\.txt|ALICE123456789012" "$tmp/o1"; then
  echo "FAIL: raw matched text leaked into output"; fail=1
else
  echo "pass: output redacted (no matched text)"
fi

# 2) allow-only file → CLEAN(0); no deny match means no candidates (covered by case 1)
bash "$SCAN" "$tmp/profile" "$tmp/clean.md" > "$tmp/o2" 2>&1
check "allow-only file exits CLEAN(0)" 0 "$?"

# 3) missing target → 5 (fail-closed, never clean)
bash "$SCAN" "$tmp/profile" "$tmp/nope-does-not-exist.md" > /dev/null 2>&1
check "missing target exits 5" 5 "$?"

# 4) comments-only profile → 4
printf '# only comments\n\n' > "$tmp/empty-profile"
bash "$SCAN" "$tmp/empty-profile" "$tmp/clean.md" > /dev/null 2>&1
check "empty profile exits 4" 4 "$?"

# 5) empty allow: entry → 4
printf 'demo-path-constant\nallow:\n' > "$tmp/bad-allow"
bash "$SCAN" "$tmp/bad-allow" "$tmp/clean.md" > /dev/null 2>&1
check "empty allow: entry exits 4" 4 "$?"

# 6) invalid regex → 6 (fail-closed even when a literal hit exists)
printf 're:[abc\nsample-deny-string\n' > "$tmp/bad-re"
printf 'sample-deny-string here\n' > "$tmp/has-sample.md"
bash "$SCAN" "$tmp/bad-re" "$tmp/has-sample.md" > /dev/null 2>&1
check "invalid regex exits 6 (not clean, not hit)" 6 "$?"

# 7) missing profile → 3
bash "$SCAN" "$tmp/no-such-profile" "$tmp/clean.md" > /dev/null 2>&1
check "missing profile exits 3" 3 "$?"

# 8) usage error → 2
bash "$SCAN" "$tmp/profile" > /dev/null 2>&1
check "no target exits 2" 2 "$?"

# 9) binary file skipped via -I → CLEAN(0)
printf 'binary\x00blob with sk-ABCDEF1234567890ABCDEF inside' > "$tmp/bin.dat"
bash "$SCAN" "$tmp/profile" "$tmp/bin.dat" > "$tmp/o3" 2>&1
check "binary file skipped via -I exits CLEAN(0)" 0 "$?"

exit $fail
