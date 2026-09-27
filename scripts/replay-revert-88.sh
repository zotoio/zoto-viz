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
  git checkout HEAD -- web plugins >/dev/null
  if ! (cd "$WEB" && pnpm exec vitest run "$test_file" -t "^${esc}$"); then
    echo "FAIL $row: base test red"
    fail=1
    continue
  fi
  git apply "$patch" || { echo "FAIL $row: git apply"; fail=1; git checkout HEAD -- web plugins; continue; }
  if out=$(cd "$WEB" && pnpm exec vitest run "$test_file" -t "^${esc}$" 2>&1); then
    echo "FAIL $row: patched still green"
    fail=1
  else
    red_json="$(python3 -c "import json;print(json.load(open('$json'))['redValue'])")"
    if ! python3 - "$red_json" "$out" <<'PY'
import json, re, sys
red = json.loads(sys.argv[1]) if sys.argv[1] not in ("true", "false", "null") else {"true": True, "false": False, "null": None}[sys.argv[1]]
out = sys.argv[2]
if isinstance(red, bool):
    pat = r"expected (true|false) to be (true|false)"
    m = re.search(pat, out)
    got = m.group(1) == "true" if m else None
    sys.exit(0 if got is red else 1)
if isinstance(red, int):
    m = re.search(r"expected (\d+) to be (\d+)", out) or re.search(r"to be called (\d+) times?, but got (\d+)", out)
    if not m:
        sys.exit(1)
    got = int(m.group(1) if "called" in m.group(0) else m.group(1))
    sys.exit(0 if got == red else 1)
if red is None:
    sys.exit(0 if "null" in out or "toBe(null)" in out else 1)
if isinstance(red, str):
    m = re.search(r'\+ Received:\s*\n\s*"([^"]*)"', out) or re.search(r'expected "([^"]*)"', out)
    got = m.group(1) if m else ""
    sys.exit(0 if got == red else 1)
sys.exit(1)
PY
    then
      echo "FAIL $row: red mismatch"
      fail=1
    fi
  fi
  git checkout HEAD -- web plugins >/dev/null
done
exit "$fail"
