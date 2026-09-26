#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ROW_DIR="$(cd "$(dirname "$0")" && pwd)"
ROW="${1:?row id without extension}"
JSON="$ROW_DIR/${ROW}.json"
PATCH="$ROW_DIR/${ROW}.patch"
if [[ ! -f "$JSON" || ! -f "$PATCH" ]]; then
  echo "missing $JSON or $PATCH" >&2
  exit 1
fi
RUNNER="$(python3 -c "import json; print(json.load(open('$JSON'))['runner'])")"
TEST_FILE="$(python3 -c "import json; print(json.load(open('$JSON'))['testFile'])")"
TEST_NAME="$(python3 -c "import json; print(json.load(open('$JSON'))['testName'])")"
NODE_ID="$(python3 -c "import json; d=json.load(open('$JSON')); print(d.get('testNodeId',''))")"
cd "$ROOT"
git apply --check "$PATCH" >/dev/null 2>&1 || { echo "patch does not apply cleanly" >&2; exit 1; }
git apply "$PATCH"
set +e
if [[ "$RUNNER" == "pytest" ]]; then
  if [[ -n "$NODE_ID" ]]; then
    OUT=$(python3 -m pytest "$NODE_ID" --no-cov -q 2>&1)
  else
    OUT=$(python3 -m pytest "$TEST_FILE" -k "$TEST_NAME" --no-cov -q 2>&1)
  fi
  RC=$?
elif [[ "$RUNNER" == "vitest" ]]; then
  OUT=$(cd "$ROOT/web" && pnpm exec vitest run "$TEST_FILE" -t "$TEST_NAME" 2>&1)
  RC=$?
else
  echo "unknown runner $RUNNER" >&2
  git checkout -- .
  exit 1
fi
set -e
git checkout -- .
if [[ "$RC" -eq 0 ]]; then
  echo "expected failure but test passed" >&2
  echo "$OUT"
  exit 1
fi
echo "$OUT"
exit 0
