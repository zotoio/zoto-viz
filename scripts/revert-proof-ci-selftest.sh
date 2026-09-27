#!/usr/bin/env bash
# CI helper: run revert-proof vitest self-tests (scripts/ via vitest.config.mjs).
# Usage:
#   revert-proof-ci-selftest.sh head
#   revert-proof-ci-selftest.sh base <base-sha>
set -euo pipefail

MODE="${1:?use head or base}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VITEST_ARGS=(
  run
  --config
  ../scripts/vitest.config.mjs
  ../scripts/revert-proof.dogfood.test.ts
  ../scripts/revert-proof.lib.test.ts
  ../scripts/revert-proof.test.ts
)

SELFTEST_PATHS=(
  scripts/revert-proof.test.ts
  scripts/revert-proof.lib.test.ts
  scripts/revert-proof.dogfood.test.ts
  scripts/vitest.config.mjs
)

ensure_python() {
  if [ ! -x ".venv/bin/python3" ]; then
    python3 -m venv .venv
    .venv/bin/pip install -q pytest
  fi
  export REVERT_PROOF_PYTHON="$ROOT/.venv/bin/python3"
}

run_vitest() {
  local label="$1"
  cd "$ROOT/web"
  set +e
  local out
  out="$(./node_modules/.bin/vitest "${VITEST_ARGS[@]}" 2>&1)"
  local status=$?
  set -e
  cd "$ROOT"
  echo "$out"
  local passed failed
  passed="$(echo "$out" | grep -Eo '[0-9]+ passed' | tail -1 | awk '{print $1}')"
  failed="$(echo "$out" | grep -Eo '[0-9]+ failed' | tail -1 | awk '{print $1}')"
  if [ -z "$passed" ]; then
    echo "revert-proof self-test (${label}): could not parse vitest pass count"
    return 1
  fi
  echo "revert-proof self-test (${label}): ${passed} passed, ${failed:-0} failed"
  return "$status"
}

ensure_python

if [ "$MODE" = "head" ]; then
  run_vitest "head runner, head tests"
  exit $?
fi

if [ "$MODE" = "base" ]; then
  BASE_SHA="${2:?base sha required for base mode}"
  if ! git cat-file -e "${BASE_SHA}:scripts/revert-proof.test.ts" 2>/dev/null; then
    echo "revert-proof self-test (head runner, base tests): SKIP — scripts/revert-proof.test.ts not present at base ${BASE_SHA} (first landing; expected for initial runner PR)"
    exit 0
  fi
  backup="$(mktemp -d)"
  for rel in "${SELFTEST_PATHS[@]}"; do
    if ! git cat-file -e "${BASE_SHA}:${rel}" 2>/dev/null; then
      echo "revert-proof self-test (head runner, base tests): FAIL — expected ${rel} at base ${BASE_SHA} but missing"
      rm -rf "$backup"
      exit 1
    fi
    cp "$rel" "$backup/$(echo "$rel" | tr '/' '_')"
    git show "${BASE_SHA}:${rel}" >"$rel"
  done
  set +e
  run_vitest "head runner, base tests"
  status=$?
  set -e
  for rel in "${SELFTEST_PATHS[@]}"; do
    cp "$backup/$(echo "$rel" | tr '/' '_')" "$rel"
  done
  rm -rf "$backup"
  exit "$status"
fi

echo "unknown mode: $MODE" >&2
exit 1
