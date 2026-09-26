#!/usr/bin/env bash
# Apply a revert-proofs/52/*.patch, run one vitest -t, print first assertion line, restore.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCH="${1:?patch file}"
TEST="${2:?vitest -t pattern}"
cd "$ROOT"
patch -p1 < "$PATCH" >/dev/null
set +e
OUT=$(cd web && pnpm exec vitest run -t "$TEST" 2>&1)
set -e
git checkout -- .
echo "$OUT" | rg "FAIL |AssertionError|expected" | head -5
