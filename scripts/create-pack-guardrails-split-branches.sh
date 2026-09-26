#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SOURCE="${1:-HEAD}"
BASE="${2:-origin/main}"

checkout_group() {
  local group_key="$1"
  BASE_REF="$BASE" SOURCE_REF="$SOURCE" GROUP_KEY="$group_key" python3 <<'PY'
import json, fnmatch, os, subprocess
from pathlib import Path

group_key = os.environ["GROUP_KEY"]
source = os.environ["SOURCE_REF"]
base = os.environ["BASE_REF"]
raw = subprocess.check_output(["git", "show", f"{source}:scripts/pack-guardrails-split-manifest.json"], text=True)
manifest = json.loads(raw)
all_changed = subprocess.check_output(["git", "diff", "--name-only", base, source], text=True).strip().splitlines()
pool = set(all_changed)

def expand(patterns):
    out = set()
    for pat in patterns:
        if pat.endswith("/**"):
            prefix = pat[:-3]
            for p in pool:
                if p.startswith(prefix):
                    out.add(p)
        elif "*" in pat:
            for p in pool:
                if fnmatch.fnmatch(p, pat):
                    out.add(p)
        elif pat in pool:
            out.add(pat)
    return sorted(out)

paths = expand(manifest[group_key])
if paths:
    subprocess.check_call(["git", "checkout", source, "--", *paths])
PY
}

git fetch origin main 2>/dev/null || true

git checkout -B cursor/pr-a-sdk-resolver-6122 "$BASE"
checkout_group groupA_sdk_resolver_lint
git add -A
git diff --cached --quiet || git commit -m "PR A: SDK, pack resolver, lint, and starter/talker guardrails"

git checkout -B cursor/pr-b-install-retry-6122 cursor/pr-a-sdk-resolver-6122
checkout_group groupB_install_retry
git add -A
git diff --cached --quiet || git commit -m "PR B: unified zip install pipeline, blocked zip retry, revert-proofs/35"

git checkout -B cursor/pr-c-viz-zoto-packs-6122 cursor/pr-a-sdk-resolver-6122
checkout_group groupC_viz_zoto_packs
git add -A
git diff --cached --quiet || git commit -m "PR C: migrate 17 packs to getVizZoto()"

git checkout cursor/pack-guardrails-6122 2>/dev/null || true
