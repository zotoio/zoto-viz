#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ROW="${1:?row basename without extension}"
JSON="$ROOT/revert-proofs/42-f/$ROW.json"
PATCH="$ROOT/revert-proofs/42-f/$ROW.patch"
cd "$ROOT/web"
KIND=$(node -pe "JSON.parse(require('fs').readFileSync('$JSON','utf8')).kind || 'vitest'")
git checkout -- . >/dev/null 2>&1 || true
git -C "$ROOT" checkout -- web/ >/dev/null 2>&1 || true
if [ "$KIND" = "tsc" ]; then
  pnpm exec tsc -p tsconfig.test.json --noEmit >/tmp/tsc-green.txt 2>&1
  git -C "$ROOT" apply "$PATCH"
  set +e
  OUT=$(pnpm exec tsc -p tsconfig.test.json --noEmit 2>&1)
  CODE=$?
  set -e
  git -C "$ROOT" checkout -- web/
  echo "$OUT"
  exit 0
fi
NAME=$(node -pe "JSON.parse(require('fs').readFileSync('$JSON','utf8')).testName")
FILE=$(node -pe "JSON.parse(require('fs').readFileSync('$JSON','utf8')).testFile")
pnpm exec vitest run "$FILE" -t "$NAME" >/tmp/vitest-green.txt 2>&1
git -C "$ROOT" apply "$PATCH"
set +e
OUT=$(pnpm exec vitest run "$FILE" -t "$NAME" 2>&1)
set -e
git -C "$ROOT" checkout -- web/
echo "$OUT" | tail -20
