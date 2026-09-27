#!/usr/bin/env bash
# CI helper: run revert-proof vitest self-tests (scripts/ via vitest.config.mjs).
# Uses pull_request checkout + base.sha only (never pull_request_target).
# Usage:
#   revert-proof-ci-selftest.sh head
#   revert-proof-ci-selftest.sh base <base-sha>
set -euo pipefail

MODE="${1:?use head or base}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

GATE="$ROOT/scripts/revert-proof-ci-gate.mjs"

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
  export REVERT_PROOF_CI_SELFTEST=1
  set +e
  local out
  out="$(./node_modules/.bin/vitest "${VITEST_ARGS[@]}" 2>&1)"
  local status=$?
  set -e
  cd "$ROOT"
  echo "$out"
  local passed failed
  passed="$(echo "$out" | grep -Eo '[0-9]+ passed' | tail -1 | awk '{print $1}')"
  failed="$(echo "$out" | grep -Eo '[0-9]+ failed' | tail -1 | awk '{print $1}' || true)"
  if [ -z "$passed" ]; then
    echo "revert-proof self-test (${label}): could not parse vitest pass count"
    return 1
  fi
  echo "revert-proof self-test (${label}): ${passed} passed, ${failed:-0} failed"
  return "$status"
}

ensure_python

if [ "$MODE" = "head" ]; then
  node "$GATE" head-present
  run_vitest "head runner, head tests"
  exit $?
fi

if [ "$MODE" = "base" ]; then
  BASE_SHA="${2:?base sha required for base mode}"
  gate_out="$(mktemp)"
  if ! node "$GATE" base-decision "$BASE_SHA" | tee "$gate_out"; then
    rm -f "$gate_out"
    exit 1
  fi
  if grep -q 'action=skip' "$gate_out"; then
    echo "revert-proof self-test (head runner, base tests): skipped per CI gate above"
    rm -f "$gate_out"
    exit 0
  fi
  rm -f "$gate_out"
  backup="$(mktemp -d)"
  for rel in "${SELFTEST_PATHS[@]}"; do
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
