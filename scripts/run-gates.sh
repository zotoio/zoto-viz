#!/usr/bin/env bash
set -euo pipefail
export PATH="/workspace/.venv/bin:$PATH"
LOG="/workspace/gates-final.log"
: > "$LOG"
run_ref() {
  local name=$1 sha=$2 remote=$3
  git -C /workspace checkout -q "$sha"
  {
    echo "===== $name $sha ====="
    echo "HEAD=$(git -C /workspace rev-parse HEAD)"
    echo "TREE=$(git -C /workspace rev-parse 'HEAD^{tree}')"
    echo "LSREMOTE=$(git ls-remote origin refs/heads/$remote | awk '{print $1}')"
    echo "PORCELAIN<<"
    git -C /workspace status --porcelain
    echo "PORCELAIN>>"
    echo "--- tsc ---"
    (cd /workspace/web && pnpm exec tsc --noEmit)
    echo "tsc_rc=0"
    echo "--- build ---"
    (cd /workspace/web && pnpm build) 2>&1 | tail -4
    echo "build_rc=${PIPESTATUS[0]}"
    echo "--- vitest ---"
    (cd /workspace/web && pnpm test) 2>&1 | tail -6
    echo "vitest_rc=${PIPESTATUS[0]}"
    echo "--- pytest ---"
    (cd /workspace && python3 -m pytest -q) 2>&1 | tail -4
    echo "pytest_rc=${PIPESTATUS[0]}"
  } >> "$LOG" 2>&1 || true
}
run_ref main 6520b014472c05f831ac5204429be2affb8473cb main
run_ref 52a d5f07263af18eec04fc1d3660ff94201c7c64bc9 cursor/dogfood-soak-52a-c58c
run_ref 52b 562020ca40a82e9c2b96e476acf86e04640d43b2 cursor/dogfood-soak-52b-c58c
run_ref 52c df50a88f0ad7ee34b87ffa72fd9791e361b4b573 cursor/dogfood-soak-52c-c58c
echo DONE >> "$LOG"
