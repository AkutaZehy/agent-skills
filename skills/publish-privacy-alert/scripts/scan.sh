#!/usr/bin/env bash
# publish-privacy-alert scanner — profile-driven pre-publish privacy scan.
#
# Exit codes — three-state invariant: any state that cannot be confirmed as
# scanned must NOT report clean.
#   0 = CLEAN (allow-candidates may be present; recorded, non-blocking)
#   1 = HIT   (deny-list match beyond allow-list)
#   2 = usage error
#   3 = profile file missing
#   4 = profile invalid (no deny entries / empty allow: or re: entry)
#   5 = target missing or unreadable (incl. broken symlinks)
#   6 = scan execution error (invalid regex, I/O, permission, unresolved symlink)
#
# Profile format: `re:<ERE>` regex deny | `allow:<literal>` pre-approved |
#                 other non-empty non-# lines = literal deny | `#` comments.
#
# Output is redacted by default: file:line + classification tag only, never
# the matched text — scanner output can itself become a leak channel (CI logs,
# reports).
#
# Implementation note: file enumeration uses find (excluding .git and
# node_modules), then one grep per file, and the scanner owns the output
# format (`file:line`). This is deliberate — system grep may be ugrep/GNU/
# BSD with different filename-printing behavior, and grep errors are never
# silently swallowed. Symlinks: file symlinks are followed; anything else
# unresolved is a scan error (6), never a silent skip.
set -uo pipefail

usage() { echo "usage: scan.sh <profile> <target>..." >&2; exit 2; }
[ $# -ge 2 ] || usage
PROFILE=$1; shift

if [ ! -f "$PROFILE" ]; then
  echo "ERROR(3): profile file missing: $PROFILE" >&2
  exit 3
fi

tmp=$(mktemp -d) || { echo "ERROR(6): mktemp failed" >&2; exit 6; }
trap 'rm -rf "$tmp"' EXIT
lit="$tmp/lit"; reg="$tmp/reg"; allow="$tmp/allow"
files="$tmp/files"; raw_lit="$tmp/raw_lit"; raw_reg="$tmp/raw_reg"; err="$tmp/err"
: > "$lit"; : > "$reg"; : > "$allow"; : > "$files"; : > "$raw_lit"; : > "$raw_reg"; : > "$err"

deny_count=0
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"   # tolerate CRLF-encoded profiles
  case "$line" in
    ''|'#'*) continue ;;
    're:'*)
      entry="${line#re:}"
      if [ -z "${entry//[[:space:]]/}" ]; then
        echo "ERROR(4): empty re: entry in profile" >&2
        exit 4
      fi
      printf '%s\n' "$entry" >> "$reg"
      deny_count=$((deny_count+1)) ;;
    'allow:'*)
      entry="${line#allow:}"
      if [ -z "${entry//[[:space:]]/}" ]; then
        echo "ERROR(4): empty allow: entry in profile" >&2
        exit 4
      fi
      printf '%s\n' "$entry" >> "$allow" ;;
    *)
      if [ -z "${line//[[:space:]]/}" ]; then continue; fi
      printf '%s\n' "$line" >> "$lit"
      deny_count=$((deny_count+1)) ;;
  esac
done < "$PROFILE"

if [ "$deny_count" -eq 0 ]; then
  echo "ERROR(4): profile has no deny entries (an allow-only profile scans nothing)" >&2
  exit 4
fi

# pre-flight: every target must exist and be readable, BEFORE any scanning —
# a typo'd path must never degrade into a clean report. Broken symlinks are
# target errors (5), not silent skips.
for t in "$@"; do
  if [ ! -e "$t" ]; then
    echo "ERROR(5): target missing: $t" >&2
    exit 5
  fi
  if [ -f "$t" ] && [ ! -r "$t" ]; then
    echo "ERROR(5): target unreadable: $t" >&2
    exit 5
  fi
done

# builtin generic patterns (secret shapes; minimal by design — profile carries specifics)
cat >> "$reg" <<'BUILTIN'
sk-[A-Za-z0-9]{16,}
-----BEGIN [A-Z ]*PRIVATE KEY-----
BUILTIN

# enumerate regular files: prune .git (local internals) and node_modules
# (dependency trees) — neither is the publish surface
scan_err=0
for t in "$@"; do
  find "$t" -name .git -type d -prune -o -name node_modules -type d -prune -o -type f -print >> "$files" 2>> "$err" || scan_err=1
done

# per-file scan: the scanner owns the output format (file:line), independent
# of whichever grep implementation is installed
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if [ -L "$f" ]; then
    if [ -f "$f" ]; then
      : # file symlink: grep will follow it (scanned like a regular file)
    else
      echo "unresolved symlink: $f" >> "$err"
      scan_err=1
      continue
    fi
  fi
  if [ -f "$f" ]; then
    if [ -s "$lit" ]; then
      grep -nIF -f "$lit" "$f" 2>> "$err" | Pref="$f" awk '{ print ENVIRON["Pref"] ":" $0 }' >> "$raw_lit"
      g=$?; case $g in 0|1) ;; *) scan_err=1 ;; esac
    fi
    if [ -s "$reg" ]; then
      grep -nIE -f "$reg" "$f" 2>> "$err" | Pref="$f" awk '{ print ENVIRON["Pref"] ":" $0 }' >> "$raw_reg"
      g=$?; case $g in 0|1) ;; *) scan_err=1 ;; esac
    fi
  fi
done < "$files"

if [ "$scan_err" -ne 0 ]; then
  echo "ERROR(6): scan execution failed — results are NOT trustworthy as clean" >&2
  if [ -s "$err" ]; then sed 's/^/  /' "$err" >&2; fi
  exit 6
fi

# classify: redacted location output; allow-matching lines are tagged as
# candidates (recorded, non-blocking) instead of being silently dropped
rc=0
candidates=0
if [ -s "$raw_lit" ]; then
  while IFS= read -r rawline; do
    loc=$(printf '%s' "$rawline" | sed -E 's/(:[0-9]+):.*$/\1/')
    if [ -s "$allow" ] && printf '%s' "$rawline" | grep -qF -f "$allow"; then
      candidates=$((candidates+1))
      echo "[allow-candidate] $loc"
    else
      rc=1
      echo "[hit:deny] $loc"
    fi
  done < "$raw_lit"
fi
if [ -s "$raw_reg" ]; then
  while IFS= read -r rawline; do
    loc=$(printf '%s' "$rawline" | sed -E 's/(:[0-9]+):.*$/\1/')
    if [ -s "$allow" ] && printf '%s' "$rawline" | grep -qF -f "$allow"; then
      candidates=$((candidates+1))
      echo "[allow-candidate] $loc"
    else
      rc=1
      echo "[hit:deny:regex] $loc"
    fi
  done < "$raw_reg"
fi

if [ "$rc" -eq 1 ]; then
  echo "HIT: deny-list match beyond allow-list — review required"
  exit 1
fi
if [ "$candidates" -gt 0 ]; then
  echo "CLEAN with allow-candidates: $candidates recorded above (non-blocking); this means no match beyond the allow-list against current profile+builtin rules, NOT the absence of sensitive content — semantic review still required"
  exit 0
fi
echo "CLEAN: no known-rule match — this means no match against current profile+builtin rules, NOT the absence of sensitive content; semantic review still required"
exit 0
