#!/usr/bin/env bash
# Opt-in quick local gate for `git push` while GitHub Actions is not running.
# Catches the catalog breakages that blanked the view menu: two pack dirs or plugin.yml ids that
# collide, a new pack missing from the pinned shipped-id / sky lists, and pack-lint baseline drift.
#
# Install (once per clone):  ln -sf ../../scripts/pre-push-quick.sh .git/hooks/pre-push
# Run by hand:               bash scripts/pre-push-quick.sh
# Skip one push:             git push --no-verify
# Needs the repo .venv (or PYTHON=...) and `cd web && pnpm install`.
set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
cd "$ROOT"
PY="${PYTHON:-}"
if [[ -z "$PY" ]]; then
  if [[ -x .venv/bin/python ]]; then PY=.venv/bin/python; else PY=python3; fi
fi

start=$SECONDS
echo "pre-push-quick: pytest (slug/id collisions, default catalog scan, pinned shipped ids)"
"$PY" -m pytest -q -p no:cacheprovider --no-cov \
  tests/test_shipped_pack_slug_collision.py \
  tests/test_shipped_catalog_manifest.py
echo "pre-push-quick: vitest (pack-lint baseline, pinned sky packs)"
(cd web && pnpm exec vitest run --project unit \
  src/plugins/pack-lint.test.ts \
  src/plugins/shipped-pack-sky.test.ts)
echo "pre-push-quick: ok in $((SECONDS - start))s"
