#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/revert-proofs/88"
cd "$ROOT"

patch_row() {
  local row=$1
  shift
  git checkout HEAD -- web plugins
  eval "$*"
  git diff -- web plugins > "$DIR/$row.patch"
  git checkout HEAD -- web plugins
}

mkjson() {
  local row=$1 file=$2 name=$3 red=$4
  printf '%s\n' "{\"testFile\":\"$file\",\"testName\":\"$name\",\"redValue\":$red}" > "$DIR/$row.json"
}

# compile-failure-log-once (same mutant as link-failure)
cp "$DIR/link-failure.patch" "$DIR/compile-failure-log-once.patch"
mkjson compile-failure-log-once "src/graph/shader-fallback-compile.test.ts" "tile shader compile latch > compile-failure-log-once" 600

patch_row nixie-write-on-change "python3 - <<'PY'
from pathlib import Path
p = Path('plugins/src/nixie-clock/frontend/tubes.ts')
p.write_text(p.read_text().replace('cache.text = parts.join(\" \");', 'cache.text = parts.join(\" \") + String(Math.random());'))
PY"
mkjson nixie-write-on-change "src/plugins/nixie-fallback.test.ts" "nixie shader fallback text > nixie-write-on-change" 600

patch_row nixie-per-tile-cache "python3 - <<'PY'
from pathlib import Path
p = Path('plugins/src/nixie-clock/frontend/index.ts')
t = p.read_text()
t = t.replace('const NIXIE_CACHE = { key: -1, text: \"\" };', 'let NIXIE_CACHE_KEY = -1;\\nlet NIXIE_CACHE_TEXT = \"\";\\nconst NIXIE_CACHE = { get key(){return NIXIE_CACHE_KEY;}, set key(v){NIXIE_CACHE_KEY=v;}, get text(){return NIXIE_CACHE_TEXT;}, set text(v){NIXIE_CACHE_TEXT=v;} };')
p.write_text(t)
PY"
mkjson nixie-per-tile-cache "src/plugins/nixie-fallback.test.ts" "nixie shader fallback text > nixie-per-tile-cache" "\"01 05 00\""

patch_row healthy-wall-no-fallback "python3 - <<'PY'
from pathlib import Path
p = Path('web/src/graph/render-host.ts')
t = p.read_text()
t = t.replace(
  '    this.supportsPackFallback = supportsPackFallback;\n  }',
  '    this.supportsPackFallback = supportsPackFallback;\n    if (supportsPackFallback && mount) {\n      const host = (mount.closest(\"#wall\") ?? mount) as HTMLElement;\n      void host;\n    }\n  }',
)
# mount fallback on any push-capable pack begin
t = t.replace(
  '    this.mount = mount;\n    this.supportsPackFallback = supportsPackFallback;',
  '    this.mount = mount;\n    this.supportsPackFallback = supportsPackFallback;\n    if (supportsPackFallback) {\n      const rh = (globalThis as unknown as { __rh?: { mountShaderFallback(id: string): void } }).__rh;\n      void rh;\n    }',
)
p.write_text(t)
PY"
# simpler: noop tickGrace already exists; force mount in beginTilePack via render-host
patch_row healthy-wall-no-fallback "python3 - <<'PY'
from pathlib import Path
p = Path('web/src/graph/render-host.ts')
old = '''  beginTilePack(
    tileId: string,
    packKey: string,
    packId: string,
    mount: HTMLElement,
    packName: string,
    supportsPackFallback = false,
  ): void {
    this.tileSlot(tileId).swapPack(packKey, packId, packName, mount, supportsPackFallback);
  }'''
new = old.replace(
  '): void {\n    this.tileSlot(tileId).swapPack',
  '): void {\n    if (supportsPackFallback) this.mountShaderFallback(tileId);\n    this.tileSlot(tileId).swapPack',
)
p.write_text(p.read_text().replace(old, new))
PY"

patch_row mosaic-tile-keyed "python3 - <<'PY'
from pathlib import Path
import re
p = Path('web/src/graph/render-host.ts')
t = p.read_text()
t2, n = re.subn(
  r'(receiveFallbackPush\(tileId: string, text: string\): void \{\n    const slot = )this\.tileSlot\(tileId\)',
  r'\1this.tileSlot(\"t1\")',
  t,
  count=1,
)
if n != 1: raise SystemExit('mosaic anchor')
p.write_text(t2)
PY"

patch_row fallback-survives-sky-reset "sed -i '/if (slot.fallback && slot.mountedFallbackPackKey === slot.packKey) return;/d' web/src/graph/render-host.ts"

patch_row context-restore-recompile "python3 - <<'PY'
from pathlib import Path
p = Path('web/src/graph/render-host.ts')
old = '''      if (slot.fallback && slot.compileFailed) {
        slot.latch.reset();
        continue;
      }
      slot.latch.reset();'''
new = '''      if (slot.fallback && slot.compileFailed) {
        continue;
      }'''
p.write_text(p.read_text().replace(old, new))
PY"

patch_row no-gl-while-lost "sed -i '/if (this.glContextLost) return { x: 0, y: 0, w: this.w, h: this.h };/d' web/src/graph/render-host.ts"

patch_row timer-cleared "python3 - <<'PY'
from pathlib import Path
p = Path('web/src/graph/gfx-wall-notice.ts')
t = p.read_text().replace(
  '    if (this.restoreTimer) {\n      clearTimeout(this.restoreTimer);\n      this.restoreTimer = null;\n    }\n',
  '',
)
p.write_text(t)
PY"

patch_row late-restore-clears-reload "python3 - <<'PY'
from pathlib import Path
p = Path('web/src/graph/gfx-wall-notice.ts')
t = p.read_text()
old = '''    if (focusOnReload) {
      this.wall.tabIndex = -1;
      this.wall.focus();
    }
    if (hadLateReload) this.opts.onDismissLateReload?.();'''
p.write_text(t.replace(old, '    if (hadLateReload) this.opts.onDismissLateReload?.();'))
PY"

mkjson nixie-text "src/plugins/nixie-fallback.test.ts" "nixie shader fallback text > nixie-text" "\"0 1 0 5 0 0\""
mkjson tunnel-write-on-change "src/plugins/shader-fallback-push.test.ts" "shader fallback push contract > tunnel-write-on-change" 124
mkjson staged-push-before-fail-immediate "src/plugins/shader-fallback-push.test.ts" "shader fallback push contract > staged-push-before-fail-immediate" "\"\""
mkjson failed-tile-survives-restore "src/plugins/shader-fallback-push.test.ts" "shader fallback push contract > failed-tile-survives-restore" "null"
mkjson context-loss-no-restore-timeout "src/graph/shader-fallback-gl.test.ts" "shader fallback gl context > context-loss-no-restore-timeout" "\"undefined\""

echo done
