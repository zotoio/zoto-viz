#!/bin/bash
set -euo pipefail
ROOT=/workspace
DIR=$ROOT/revert-proofs/88
mkdir -p "$DIR"
cd "$ROOT"

mkjson() {
  local row=$1 file=$2 name=$3 red=$4
  printf '%s\n' "{\"testFile\":\"$file\",\"testName\":\"$name\",\"redValue\":$red}" > "$DIR/$row.json"
}

patch_row() {
  local row=$1
  git checkout HEAD -- .
  eval "$2"
  git diff > "$DIR/$row.patch"
  git checkout HEAD -- .
}

# compile-once
patch_row compile-once "sed -i '/if (this.failed) return/d' web/src/graph/tile-shader-build.ts; sed -i '/if (this.compiled) return/d' web/src/graph/tile-shader-build.ts"
mkjson compile-once "src/graph/shader-fallback-compile.test.ts" "tile shader compile latch > compile-once" 1200

# link-failure — drop link-path latch only (compile still short-circuits)
patch_row link-failure "sed -i '/if (this.failed) return/d' web/src/graph/tile-shader-build.ts; sed -i '/if (this.compiled && this.compiledGen === gen) return/d' web/src/graph/tile-shader-build.ts; python3 - <<'PY'
from pathlib import Path
p = Path('web/src/graph/tile-shader-build.ts')
lines = p.read_text().splitlines(True)
out = []
for i, line in enumerate(lines):
    if 'this.fail(msg, log);' in line and i > 0 and 'link failed' in lines[i - 1]:
        continue
    out.append(line)
p.write_text(''.join(out))
PY"
mkjson link-failure "src/graph/shader-fallback-compile.test.ts" "tile shader compile latch > link-failure" 600

# host-generic-copy
patch_row host-generic-copy "sed -i '/mount.appendChild(this.root);/d' web/src/graph/tile-shader-fallback.ts"
mkjson host-generic-copy "src/graph/shader-fallback-host.test.ts" "tile shader fallback host > host-generic-copy" 0

# simple-view-chip
patch_row simple-view-chip "sed -i '/if (this.showChip) this.root.appendChild(this.chip);/d' web/src/graph/tile-shader-fallback.ts"
mkjson simple-view-chip "src/graph/shader-fallback-host.test.ts" "tile shader fallback host > simple-view-chip" 0

# nixie-text  
patch_row nixie-text "sed -i 's/cache.text = parts.join(\" \");/cache.text = parts.join(\" \").split(\"\").join(\" \");/' plugins/src/nixie-clock/frontend/tubes.ts"
mkjson nixie-text "src/plugins/nixie-fallback.test.ts" "nixie shader fallback text > nixie-text" "\"0 1 0 5 0 0\""

# nixie-write-on-change
patch_row nixie-write-on-change "sed -i 's/if (next === this.lastWritten) return;/if (false \&\& next === this.lastWritten) return;/' web/src/graph/tile-shader-fallback.ts"
mkjson nixie-write-on-change "src/plugins/nixie-fallback.test.ts" "nixie shader fallback text > nixie-write-on-change" 600

# pack-name-sanitise
patch_row pack-name-sanitise "sed -i '/PACK_NAME_MAX/d' web/src/graph/sanitize-pack-name.ts; sed -i '/if (s.length > PACK_NAME_MAX)/d' web/src/graph/sanitize-pack-name.ts"
mkjson pack-name-sanitise "src/graph/shader-fallback-host.test.ts" "tile shader fallback host > pack-name-sanitise" 134

# nixie-per-tile-cache — shared module cache (breaks per-pack instance isolation)
patch_row nixie-per-tile-cache "python3 - <<'PY'
from pathlib import Path
p=Path('plugins/src/nixie-clock/frontend/index.ts')
t=p.read_text()
t=t.replace('const NIXIE_CACHE = { key: -1, text: \"\" };', 'let NIXIE_CACHE_KEY = -1;\\nlet NIXIE_CACHE_TEXT = \"\";\\nconst NIXIE_CACHE = { get key(){return NIXIE_CACHE_KEY;}, set key(v){NIXIE_CACHE_KEY=v;}, get text(){return NIXIE_CACHE_TEXT;}, set text(v){NIXIE_CACHE_TEXT=v;} };')
p.write_text(t)
PY"
mkjson nixie-per-tile-cache "src/plugins/nixie-fallback.test.ts" "nixie shader fallback text > nixie-per-tile-cache" "\"01 05 00\""

# fallback-throws-latched
patch_row fallback-throws-latched "sed -i 's/} catch {/} catch (e) { throw e; } catch {/' web/src/graph/tile-shader-fallback.ts"
# simpler: remove latchGeneric in catch
patch_row fallback-throws-latched "python3 - <<'PY'
from pathlib import Path
p=Path('web/src/graph/tile-shader-fallback.ts')
t=p.read_text().replace('    } catch {\n      this.latchGeneric();\n    }','    } catch {\n      /* no latch */\n    }')
p.write_text(t)
PY"
mkjson fallback-throws-latched "src/graph/shader-fallback-bad-pack.test.ts" "shader fallback bad pack text > fallback-throws-latched" 600

patch_row fallback-empty-latched "python3 - <<'PY'
from pathlib import Path
p=Path('web/src/graph/tile-shader-fallback.ts')
t=p.read_text().replace('      if (!next.trim()) {\n        this.latchGeneric();\n        return;\n      }','      if (!next.trim()) {\n        return;\n      }')
p.write_text(t)
PY"
mkjson fallback-empty-latched "src/graph/shader-fallback-bad-pack.test.ts" "shader fallback bad pack text > fallback-empty-latched" 600

# healthy-wall
patch_row healthy-wall-no-fallback "python3 - <<'PY'
from pathlib import Path
p=Path('web/src/graph/render-host.ts')
t=p.read_text().replace(
  '''  driveShaderFallbacks(frame: VizDataFrame): void {
    for (let i = 0; i < this.liveFallbacks.length; i++) {
      this.liveFallbacks[i]!.frame(frame);
    }
  }''',
  '  driveShaderFallbacks(_frame: VizDataFrame): void {}')
p.write_text(t)
PY"
mkjson healthy-wall-no-fallback "src/graph/shader-fallback-wall.test.ts" "shader fallback wall > healthy-wall-no-fallback" 0

# isolated-tile-failure global dead
patch_row isolated-tile-failure "python3 - <<'PY'
from pathlib import Path
p=Path('web/src/graph/render-host.ts')
insert='  private globalShaderDead = false;\n'
t=p.read_text()
if 'globalShaderDead' not in t:
  t=t.replace('  private glContextLost = false;\n', '  private glContextLost = false;\n'+insert)
  t=t.replace(
    '  buildTileShader(tileId: string, frag: string, log: (msg: string) => void = () => {}): boolean {\n    if (this.software) return true;',
    '  buildTileShader(tileId: string, frag: string, log: (msg: string) => void = () => {}): boolean {\n    if (this.globalShaderDead) return false;\n    if (this.software) return true;')
  t=t.replace(
    '    return this.tileSlot(tileId).build(gl, frag, log);\n  }',
    '    const ok = this.tileSlot(tileId).build(gl, frag, log);\n    if (!ok) this.globalShaderDead = true;\n    return ok;\n  }')
  p.write_text(t)
PY"
mkjson isolated-tile-failure "src/graph/shader-fallback-wall.test.ts" "shader fallback wall > isolated-tile-failure" 0

# pack-swap
patch_row pack-swap-clears-fallback "python3 - <<'PY'
from pathlib import Path
p=Path('web/src/graph/render-host.ts')
t=p.read_text().replace('      this.fallback?.dispose();\n      this.fallback = null;\n','')
p.write_text(t)
PY"
mkjson pack-swap-clears-fallback "src/graph/shader-fallback-wall.test.ts" "shader fallback wall > pack-swap-clears-fallback" 1

# context loss notice
patch_row context-loss-notice-no-generic "sed -i 's/this.gfxNotice.onContextLost();//' web/src/graph/render-host.ts"
mkjson context-loss-notice-no-generic "src/graph/shader-fallback-gl.test.ts" "shader fallback gl context > context-loss-notice-no-generic" 0

patch_row context-restore-recompile "sed -i 's/slot.latch.reset();//' web/src/graph/render-host.ts"
mkjson context-restore-recompile "src/graph/shader-fallback-gl.test.ts" "shader fallback gl context > context-restore-recompile" 0

patch_row context-loss-no-restore-timeout "sed -i '/onRestoreTimeout/,+10d' web/src/graph/gfx-wall-notice.ts"
mkjson context-loss-no-restore-timeout "src/graph/shader-fallback-gl.test.ts" "shader fallback gl context > context-loss-no-restore-timeout" 0

patch_row gfx-notice-copy-literals "sed -i 's/Graphics were interrupted/Was interrupted/' web/src/graph/shader-fallback-copy.ts"
mkjson gfx-notice-copy-literals "src/graph/shader-fallback-gl.test.ts" "shader fallback gl context > gfx-notice-copy-literals" "\"wrong\""

# restore-resets-keys — cache hit ignores context generation
patch_row restore-resets-keys "sed -i 's/prev.gen === next.gen && //' web/src/graph/context-cache-key.ts"
mkjson restore-resets-keys "src/graph/shader-fallback-context-gen.test.ts" "shader fallback context gen > restore-resets-keys" 0

# no-gl-while-lost — keep drawing while GL context is lost
patch_row no-gl-while-lost "sed -i '/if (this.glContextLost) return { x:/d' web/src/graph/render-host.ts"
mkjson no-gl-while-lost "src/graph/shader-fallback-context-gen.test.ts" "shader fallback context gen > no-gl-while-lost" 2400

# listeners-once — re-register canvas listeners on every restore
patch_row listeners-once "python3 - <<'PY'
from pathlib import Path
p=Path('web/src/graph/render-host.ts')
t=p.read_text()
t=t.replace(
  '  if (marked[GL_CONTEXT_LISTENERS_KEY]) return;\\n  marked[GL_CONTEXT_LISTENERS_KEY] = true;\\n',
  '',
)
extra='''    attachGlContextListeners(
      this.canvas,
      (e) => {
        e.preventDefault();
        this.onSharedContextLost();
        for (const v of this.views) v.hostContextLost();
      },
      () => {
        this.onSharedContextRestored();
        this.dirty = true;
        for (const v of this.views) v.hostContextRestored();
      },
    );
'''
t=t.replace(
  '    this.contextGen = mintContextGen((this.contextGen as number) + 1);',
  '    this.contextGen = mintContextGen((this.contextGen as number) + 1);\\n' + extra,
)
p.write_text(t)
PY"
mkjson listeners-once "src/graph/shader-fallback-context-gen.test.ts" "shader fallback context gen > listeners-once" 4

# loss-prevent-default
patch_row loss-prevent-default "sed -i 's/e.preventDefault();//' web/src/graph/render-host.ts"
mkjson loss-prevent-default "src/graph/shader-fallback-context-gen.test.ts" "shader fallback context gen > loss-prevent-default" false

# timer-cleared
patch_row timer-cleared "python3 - <<'PY'
from pathlib import Path
p=Path('web/src/graph/gfx-wall-notice.ts')
t=p.read_text()
t=t.replace(
  '    if (this.restoreTimer) {\\n      clearTimeout(this.restoreTimer);\\n      this.restoreTimer = null;\\n    }\\n',
  '',
)
p.write_text(t)
PY"
mkjson timer-cleared "src/graph/shader-fallback-context-gen.test.ts" "shader fallback context gen > timer-cleared" 1

# late-restore-clears-reload — drop reload button only (focus falls through to body)
patch_row late-restore-clears-reload "$(cat <<'EOS'
python3 - <<'PY'
from pathlib import Path
p=Path('web/src/graph/gfx-wall-notice.ts')
t=p.read_text()
sel = "`." + "${GFX_WALL_RELOAD_CLASS}`)"
old = f"""    const btn = this.el?.querySelector({sel} as HTMLButtonElement | null;
    const focusOnReload = btn !== null && document.activeElement === btn;
    const hadLateReload = this.reloadOffered;
    this.el?.remove();
    this.el = null;
    this.shown = false;
    this.reloadOffered = false;
    if (focusOnReload) {{
      this.wall.tabIndex = -1;
      this.wall.focus();
    }}
    if (hadLateReload) this.opts.onDismissLateReload?.();"""
new = f"""    const btn = this.el?.querySelector({sel} as HTMLButtonElement | null;
    const hadLateReload = this.reloadOffered;
    if (btn) btn.remove();
    else {{
      this.el?.remove();
      this.el = null;
    }}
    this.shown = false;
    this.reloadOffered = false;
    if (hadLateReload) this.opts.onDismissLateReload?.();"""
if old not in t:
  raise SystemExit('late-restore patch anchor missing')
p.write_text(t.replace(old, new))
PY
EOS
)"
mkjson late-restore-clears-reload "src/graph/shader-fallback-gl.test.ts" "shader fallback gl context > late-restore-clears-reload" 0

# B5 rows
patch_row scene-mounts-fallback "sed -i '/if (!ok) this.mountShaderFallback(tileId);/d' web/src/graph/render-host.ts"
mkjson scene-mounts-fallback "src/graph/shader-fallback-wall.test.ts" "shader fallback wall > scene-mounts-fallback" 0

patch_row fallback-survives-sky-reset "sed -i '/if (slot.fallback && slot.mountedFallbackPackKey === slot.packKey) return;/d' web/src/graph/render-host.ts"
mkjson fallback-survives-sky-reset "src/graph/shader-fallback-wall.test.ts" "shader fallback wall > fallback-survives-sky-reset" 2

patch_row drive-writes-tile "sed -i 's/slot.fallback?.pushPackText(text);//' web/src/graph/render-host.ts"
mkjson drive-writes-tile "src/graph/shader-fallback-wall.test.ts" "shader fallback wall > drive-writes-tile" "\"\""

patch_row mosaic-tile-keyed "sed -i 's/return this.tileSlot(tileId).build/return this.tileSlot(\"t1\").build/' web/src/graph/render-host.ts"
mkjson mosaic-tile-keyed "src/graph/shader-fallback-wall.test.ts" "shader fallback wall > mosaic-tile-keyed" 0

patch_row tunnel-write-on-change "sed -i '/if (key === ptKey) return ptCached;/d' plugins/src/packet-tunnel/frontend/tunnel.ts"
mkjson tunnel-write-on-change "src/plugins/packet-tunnel-fallback.test.ts" "packet tunnel fallback text > tunnel-write-on-change" 119

echo "done"
