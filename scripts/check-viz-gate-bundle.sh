#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/web"
OUT="${ZOTO_VIZ_GATE_DIST:-$WEB/dist-gate-check}"
rm -rf "$OUT"
export ZOTO_VIZ_GATE_BUILD=1
unset VITEST
cd "$WEB"
pnpm exec vite build --outDir "$(basename "$OUT")" --emptyOutDir
JS_DIR="$OUT/assets"
shopt -s nullglob
JS=( "$JS_DIR"/*.js )
if ((${#JS[@]} < 1)); then
  echo "no JS assets in $JS_DIR" >&2
  exit 1
fi
if grep -q 'function bumpFlowVisit(' "${JS[@]}"; then
  echo "gate bundle still contains bumpFlowVisit instrumentation" >&2
  exit 1
fi
if grep -q 'function bumpRateCall(' "${JS[@]}"; then
  echo "gate bundle still contains bumpRateCall instrumentation" >&2
  exit 1
fi
echo "viz gate bundle ok ($OUT)"
