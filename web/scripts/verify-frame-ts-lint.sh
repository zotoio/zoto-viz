#!/usr/bin/env bash
# Demonstrates FrameTs cast lint: fails on stray `as FrameTs`, passes after frameTsFromRaf routing.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
LINT=(node --require ./eslint-ts6-resolver.cjs ./node_modules/eslint/bin/eslint.js)

echo "== Inject stray as FrameTs (pre-routing stand-in) =="
git checkout HEAD -- \
  src/graph/render-host.ts \
  src/graph/scene.ts \
  src/ui/feed.ts \
  src/ui/chat.ts \
  src/arcade/arcade.ts

perl -pi -e 's/frameTsFromRaf\((\w+)\)/$1 as FrameTs/g' \
  src/graph/render-host.ts \
  src/graph/scene.ts \
  src/ui/feed.ts \
  src/ui/chat.ts \
  src/arcade/arcade.ts

for f in src/graph/render-host.ts src/graph/scene.ts src/ui/feed.ts src/ui/chat.ts src/arcade/arcade.ts; do
  if ! rg -q 'import type \{ FrameTs \}' "$f" && rg -q ' as FrameTs' "$f"; then
    sed -i '1a import type { FrameTs } from "../core/time-ms";' "$f" 2>/dev/null || true
  fi
done

# render-host already imports FrameTs via time-ms; ensure type import
if ! rg -q 'FrameTs' src/graph/render-host.ts; then
  sed -i 's/frameTsFromRaf, /type { FrameTs }, frameTsFromRaf, /' src/graph/render-host.ts || \
    sed -i 's/import { frameTsFromRaf/import type { FrameTs } from "..\/core\/time-ms";\nimport { frameTsFromRaf/' src/graph/render-host.ts
fi

set +e
"${LINT[@]}" src/graph/render-host.ts src/graph/scene.ts src/ui/feed.ts src/ui/chat.ts src/arcade/arcade.ts 2>&1 | tee /tmp/frame-ts-lint-before.txt
BEFORE_RC=${PIPESTATUS[0]}
set -e

echo "== Restore frameTsFromRaf routing =="
git checkout HEAD -- \
  src/graph/render-host.ts \
  src/graph/scene.ts \
  src/ui/feed.ts \
  src/ui/chat.ts \
  src/arcade/arcade.ts

"${LINT[@]}" src/graph/render-host.ts src/graph/scene.ts src/ui/feed.ts src/ui/chat.ts src/arcade/arcade.ts
echo "lint clean after routing"

if [[ "$BEFORE_RC" -eq 0 ]]; then
  echo "expected lint failure on stray casts" >&2
  exit 1
fi
