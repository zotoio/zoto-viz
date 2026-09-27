#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/revert-proofs/88"
WEB="$ROOT/web"
cd "$ROOT"
fail=0
for json in "$DIR"/*.json; do
  [[ "$json" == *".sidecar.json" ]] && continue
  [[ "$(basename "$json" .json)" == "hunk-map" ]] && continue
  row="$(basename "$json" .json)"
  patch="$DIR/$row.patch"
  [[ -f "$patch" ]] || { echo "missing patch $row"; fail=1; continue; }
  test_file="$(python3 -c "import json;print(json.load(open('$json'))['testFile'])")"
  test_name="$(python3 -c "import json;print(json.load(open('$json'))['testName'])")"
  esc="${test_name//\'/\'\\\'\'}"
  echo "== $row =="
  git checkout HEAD -- web plugins >/dev/null
  if ! (cd "$WEB" && pnpm exec vitest run "$test_file" -t "^${esc}$"); then
    echo "FAIL $row: base test red"
    fail=1
    continue
  fi
  git apply "$patch" || { echo "FAIL $row: git apply"; fail=1; git checkout HEAD -- web plugins; continue; }
  set +e
  out="$(cd "$WEB" && pnpm exec vitest run "$test_file" -t "^${esc}$" 2>&1)"
  patched_code=$?
  set -e
  if [[ "$patched_code" -eq 0 ]]; then
    echo "FAIL $row: patched still green"
    fail=1
  else
    if ! python3 - "$json" "$out" <<'PY'
import importlib.util, json, sys
from pathlib import Path
root = Path(__file__).resolve().parents[1] if False else Path.cwd()
spec = importlib.util.spec_from_file_location("regen", "scripts/regen-revert-88.py")
regen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(regen)
side = json.load(open(sys.argv[1]))
want = side["redValue"]
try:
    got = regen.extract_red(sys.argv[2])
except ValueError:
    sys.exit(1)
sys.exit(0 if got == want else 1)
PY
    then
      echo "FAIL $row: red mismatch"
      fail=1
    fi
  fi
  git checkout HEAD -- web plugins >/dev/null
done
exit "$fail"
