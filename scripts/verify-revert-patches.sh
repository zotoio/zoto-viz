#!/usr/bin/env bash
set -euo pipefail
ROOT=/workspace
cd "$ROOT"
fail=0
for dir in revert-proofs/42 revert-proofs/86; do
  for patch in "$dir"/*.patch; do
    [[ -f "$patch" ]] || continue
    name=$(basename "$patch")
    git checkout HEAD -- web >/dev/null 2>&1
    out=$(git apply --check -v "$patch" 2>&1) || { echo "APPLY FAIL $patch"; echo "$out"; fail=1; continue; }
    if echo "$out" | rg -q 'offset [0-9]+'; then
      echo "OFFSET $dir/$name"
      echo "$out" | rg 'succeeded|offset|fuzz'
      fail=1
    fi
    if echo "$out" | rg -q 'with fuzz'; then
      echo "FUZZ $dir/$name"
      fail=1
    fi
  done
done
exit "$fail"
