#!/usr/bin/env bash
# Run one regression test with a one-line production revert; print vitest failure output.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/web"
FILE="$1"
REVERT_LINE="$2"
TEST_NAME="$3"
cd "$WEB"
cp "$ROOT/$FILE" "/tmp/revert-proof.bak"
# Apply revert: replace first matching line pattern via node for safety
node -e "
const fs=require('fs');
const p='$ROOT/$FILE';
let s=fs.readFileSync(p,'utf8');
const [from,to]=process.argv[1].split('|||');
if(!s.includes(from)) { console.error('revert pattern not found'); process.exit(2); }
fs.writeFileSync(p,s.replace(from,to));
" "$REVERT_LINE"
set +e
OUT=$(pnpm exec vitest run -t "$TEST_NAME" 2>&1)
STATUS=$?
set -e
mv "/tmp/revert-proof.bak" "$ROOT/$FILE"
if [[ $STATUS -eq 0 ]]; then
  echo "UNEXPECTED PASS for: $TEST_NAME"
  echo "$OUT"
  exit 1
fi
echo "$OUT" | tail -25
