#!/bin/bash
set -euo pipefail
PR_DIR=/workspace/revert-proofs/42
for json in "$PR_DIR"/*.json; do
  name=$(basename "$json" .json)
  patch="$PR_DIR/$name.patch"
  [[ -f "$patch" ]] || continue
  cd /workspace
  git checkout HEAD -- . >/dev/null 2>&1 || true
  git apply "$patch"
  tf=$(python3 -c "import json; print(json.load(open('$json'))['testFile'])")
  tn=$(python3 -c "import json; print(json.load(open('$json'))['testName'])")
  cd web
  set +e
  out=$(pnpm exec vitest run "$tf" -t "$tn" 2>&1)
  code=$?
  set -e
  cd /workspace
  git checkout HEAD -- . >/dev/null 2>&1
  if [[ $code -eq 0 ]]; then
    echo "FAIL $name: patched passed"
  else
    echo "OK $name"
    echo "$out" | rg "AssertionError|expected" | head -2
  fi
done
