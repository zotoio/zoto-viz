#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/revert-proofs/88"
WEB="$ROOT/web"
cd "$ROOT"
fail=0
for json in "$DIR"/*.json; do
  [[ "$json" == *".sidecar.json" ]] && continue
  row="$(basename "$json" .json)"
  patch="$DIR/$row.patch"
  [[ -f "$patch" ]] || { echo "missing patch $row"; fail=1; continue; }
  test_file="$(python3 -c "import json;print(json.load(open('$json'))['testFile'])")"
  test_name="$(python3 -c "import json;print(json.load(open('$json'))['testName'])")"
  esc="${test_name//\'/\'\\\'\'}"
  echo "== $row =="
  git checkout HEAD -- . >/dev/null
  if ! (cd "$WEB" && pnpm exec vitest run "$test_file" -t "^${esc}$"); then
    echo "FAIL $row: base test red"
    fail=1
    continue
  fi
  git apply "$patch" || { echo "FAIL $row: git apply"; fail=1; git checkout HEAD -- .; continue; }
  if (cd "$WEB" && pnpm exec vitest run "$test_file" -t "^${esc}$"); then
    echo "FAIL $row: patched still green"
    fail=1
  fi
  git checkout HEAD -- . >/dev/null
done
exit "$fail"
