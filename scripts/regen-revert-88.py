#!/usr/bin/env python3
"""Regenerate revert-proofs/88 patches and sidecars from production-only mutants."""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIR = ROOT / "revert-proofs" / "88"
WEB = ROOT / "web"


def run(cmd: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=cwd or ROOT, text=True, capture_output=True)


def git_reset() -> None:
    run(["git", "checkout", "HEAD", "--", "web", "plugins"])


def save_patch(mutate: str) -> None:
    git_reset()
    subprocess.run(mutate, shell=True, cwd=ROOT, check=True)
    diff = run(["git", "diff", "--", "web", "plugins"])
    if diff.returncode != 0 or not diff.stdout.strip():
        raise SystemExit(f"empty diff for mutate: {mutate[:80]}")
    return diff.stdout


def vitest(file: str, test_name: str) -> tuple[int, str]:
    esc = test_name.replace("'", "'\\''")
    p = run(
        ["pnpm", "exec", "vitest", "run", file, "-t", f"^{esc}$"],
        cwd=WEB,
    )
    return p.returncode, p.stdout + p.stderr


def extract_red(output: str) -> str | int | bool:
    m = re.search(r'expected "vi\.fn\(\)" to be called \d+ times?, but got (\d+)', output)
    if m:
        return int(m.group(1))
    m = re.search(r'expected "(.+?)" to be called \d+ times?, but got (\d+)', output)
    if m:
        return int(m.group(2))
    m = re.search(r"to have a length of \d+ but got \+(\d+)", output)
    if m:
        return int(m.group(1))
    m = re.search(r"\+ Received:\s*\n\s*\"([^\"]*)\"", output)
    if m and "toMatch" in output:
        return m.group(1)
    m = re.search(r"expected (\d+) to be (\d+) //", output)
    if m:
        return int(m.group(1))
    m = re.search(r"expected (.+?) to be (.+?) //", output)
    if m:
        got, _want = m.group(1), m.group(2)
        if got in ("true", "false"):
            return got == "true"
        if got.startswith('"'):
            return json.loads(got)
        if re.fullmatch(r"-?\d+", got):
            return int(got)
        return got.strip()
    raise ValueError(f"could not parse red from:\n{output[-2500:]}")


def mkjson(row: str, test_file: str, test_name: str, red) -> None:
    if isinstance(red, str):
        red_json = json.dumps(red)
    elif isinstance(red, bool):
        red_json = "true" if red else "false"
    else:
        red_json = str(red)
    body = (
        f'{{"testFile":"{test_file}","testName":"{test_name}","redValue":{red_json}}}\n'
    )
    (DIR / f"{row}.json").write_text(body)


ROWS: list[tuple[str, str, str, str]] = [
    (
        "compile-once",
        "src/graph/shader-fallback-compile.test.ts",
        "tile shader compile latch > compile-once",
        "sed -i '/if (latch.isFresh(gen)) return true;/d' web/src/graph/render-host.ts",
    ),
    (
        "link-failure",
        "src/graph/shader-fallback-compile.test.ts",
        "tile shader compile latch > link-failure",
        r"""python3 - <<'PY'
from pathlib import Path
rh = Path('web/src/graph/render-host.ts')
t = rh.read_text()
t = t.replace('    if (latch.dead) return false;\n', '', 1)
rh.write_text(t)
lt = Path('web/src/graph/tile-shader-latch.ts')
t2 = lt.read_text()
t2 = t2.replace('  fail(msg: string, log: (m: string) => void): void {\n    if (this.failed) return;\n', '  fail(msg: string, log: (m: string) => void): void {\n')
lt.write_text(t2)
PY""",
    ),
    (
        "compile-failure-log-once",
        "src/graph/shader-fallback-compile.test.ts",
        "tile shader compile latch > compile-failure-log-once",
        r"""python3 - <<'PY'
from pathlib import Path
rh = Path('web/src/graph/render-host.ts')
rh.write_text(rh.read_text().replace('    if (latch.dead) return false;\n', '', 1))
lt = Path('web/src/graph/tile-shader-latch.ts')
lt.write_text(lt.read_text().replace(
  '  fail(msg: string, log: (m: string) => void): void {\n    if (this.failed) return;\n',
  '  fail(msg: string, log: (m: string) => void): void {\n',
))
PY""",
    ),
    (
        "host-generic-copy",
        "src/graph/shader-fallback-host.test.ts",
        "tile shader fallback host > host-generic-copy",
        "sed -i '/mount.appendChild(this.root);/d' web/src/graph/tile-shader-fallback.ts",
    ),
    (
        "simple-view-chip",
        "src/graph/shader-fallback-host.test.ts",
        "tile shader fallback host > simple-view-chip",
        "sed -i '/if (on && !this.chip.parentElement) this.root.appendChild(this.chip);/d' web/src/graph/tile-shader-fallback.ts",
    ),
    (
        "nixie-text",
        "src/plugins/nixie-fallback.test.ts",
        "nixie shader fallback text > nixie-text",
        r"""python3 - <<'PY'
from pathlib import Path
p = Path('plugins/src/nixie-clock/frontend/tubes.ts')
t = p.read_text()
t = t.replace('cache.text = parts.join(" ");', 'cache.text = parts.join(" ").split("").join(" ");')
p.write_text(t)
PY""",
    ),
    (
        "nixie-write-on-change",
        "src/plugins/nixie-fallback.test.ts",
        "nixie shader fallback text > nixie-write-on-change",
        r"""python3 - <<'PY'
from pathlib import Path
p = Path('plugins/src/nixie-clock/frontend/tubes.ts')
t = p.read_text()
t = t.replace('  if (key === cache.key) return cache.text;\n', '')
t = t.replace(
  'cache.text = parts.join(" ");',
  'cache.text = parts.join(" ") + String(Math.random());',
)
p.write_text(t)
PY""",
    ),
    (
        "pack-name-sanitise",
        "src/graph/shader-fallback-host.test.ts",
        "tile shader fallback host > pack-name-sanitise",
        r"""python3 - <<'PY'
from pathlib import Path
p = Path('web/src/graph/sanitize-pack-name.ts')
lines = [ln for ln in p.read_text().splitlines(True) if 'PACK_NAME_MAX' not in ln and 'if (s.length > PACK_NAME_MAX)' not in ln]
p.write_text(''.join(lines))
PY""",
    ),
    (
        "nixie-per-tile-cache",
        "src/plugins/nixie-fallback.test.ts",
        "nixie shader fallback text > nixie-per-tile-cache",
        r"""python3 - <<'PY'
from pathlib import Path
p = Path('plugins/src/nixie-clock/frontend/index.ts')
t = p.read_text()
t = t.replace('const NIXIE_CACHE = { key: -1, text: "" };', 'let NIXIE_CACHE_KEY = -1;\\nlet NIXIE_CACHE_TEXT = "";\\nconst NIXIE_CACHE = { get key(){return NIXIE_CACHE_KEY;}, set key(v){NIXIE_CACHE_KEY=v;}, get text(){return NIXIE_CACHE_TEXT;}, set text(v){NIXIE_CACHE_TEXT=v;} };')
p.write_text(t)
PY""",
    ),
    (
        "fallback-throws-latched",
        "src/graph/shader-fallback-bad-pack.test.ts",
        "shader fallback bad pack text > fallback-throws-latched",
        r"""python3 - <<'PY'
from pathlib import Path
p = Path('web/src/graph/tile-shader-fallback.ts')
t = p.read_text().replace('    } catch {\n      this.latchGeneric();\n    }', '    } catch {\n      /* no latch */\n    }')
p.write_text(t)
PY""",
    ),
    (
        "fallback-empty-latched",
        "src/graph/shader-fallback-bad-pack.test.ts",
        "shader fallback bad pack text > fallback-empty-latched",
        "sed -i 's/if (this.graceLeft === 0) this.latchGeneric();/if (this.graceLeft === 0) {}/' web/src/graph/tile-shader-fallback.ts",
    ),
    (
        "healthy-wall-no-fallback",
        "src/graph/shader-fallback-wall.test.ts",
        "shader fallback wall > healthy-wall-no-fallback",
        r"""python3 - <<'PY'
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
  'this.tileSlot(tileId).swapPack(packKey, packId, packName, mount, supportsPackFallback);\n  }',
  'this.tileSlot(tileId).swapPack(packKey, packId, packName, mount, supportsPackFallback);\n    if (supportsPackFallback) this.mountShaderFallback(tileId);\n  }',
)
t = p.read_text()
if old not in t:
    raise SystemExit('beginTilePack block missing')
p.write_text(t.replace(old, new))
PY""",
    ),
    (
        "isolated-tile-failure",
        "src/graph/shader-fallback-wall.test.ts",
        "shader fallback wall > isolated-tile-failure",
        r"""python3 - <<'PY'
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
  'this.tileSlot(tileId).swapPack(packKey, packId, packName, mount, supportsPackFallback);\n  }',
  'this.tileSlot(tileId).swapPack(packKey, packId, packName, mount, supportsPackFallback);\n    if (supportsPackFallback) this.mountShaderFallback(tileId);\n  }',
)
t = p.read_text()
if old not in t:
    raise SystemExit('beginTilePack block missing')
p.write_text(t.replace(old, new))
PY""",
    ),
    (
        "pack-swap-clears-fallback",
        "src/graph/shader-fallback-wall.test.ts",
        "shader fallback wall > pack-swap-clears-fallback",
        r"""python3 - <<'PY'
from pathlib import Path
p = Path('web/src/graph/render-host.ts')
t = p.read_text().replace('      this.fallback?.dispose();\n      this.fallback = null;\n', '')
p.write_text(t)
PY""",
    ),
    (
        "scene-mounts-fallback",
        "src/graph/shader-fallback-wall.test.ts",
        "shader fallback wall > scene-mounts-fallback",
        r"""python3 - <<'PY'
from pathlib import Path
p = Path('web/src/graph/render-host.ts')
t = p.read_text().replace(
  '  onTileShaderCompileFailed(tileId: string): void {\n    this.mountShaderFallback(tileId);\n  }',
  '  onTileShaderCompileFailed(_tileId: string): void {}',
)
p.write_text(t)
PY""",
    ),
    (
        "fallback-survives-sky-reset",
        "src/graph/shader-fallback-wall.test.ts",
        "shader fallback wall > fallback-survives-sky-reset",
        "sed -i '/if (slot.fallback && slot.mountedFallbackPackKey === slot.packKey) return;/d' web/src/graph/render-host.ts",
    ),
    (
        "drive-writes-tile",
        "src/graph/shader-fallback-wall.test.ts",
        "shader fallback wall > drive-writes-tile",
        "sed -i 's/slot.fallback.pushPackText(trimmed);/slot.fallback.pushPackText(\"\");/' web/src/graph/render-host.ts",
    ),
    (
        "mosaic-tile-keyed",
        "src/graph/shader-fallback-wall.test.ts",
        "shader fallback wall > mosaic-tile-keyed",
        r"""python3 - <<'PY'
from pathlib import Path
import re
p = Path('web/src/graph/render-host.ts')
t = p.read_text()
t2, n = re.subn(
    r'(receiveFallbackPush\(tileId: string, text: string\): void \{\n    const slot = )this\.tileSlot\(tileId\)',
    r'\1this.tileSlot("t1")',
    t,
    count=1,
)
if n != 1:
    raise SystemExit('mosaic anchor missing')
p.write_text(t2)
PY""",
    ),
    (
        "tunnel-write-on-change",
        "src/plugins/shader-fallback-push.test.ts",
        "shader fallback push contract > tunnel-write-on-change",
        "sed -i '/if (key === ptKey) return ptCached;/d' plugins/src/packet-tunnel/frontend/tunnel.ts",
    ),
    (
        "failed-tile-survives-restore",
        "src/plugins/shader-fallback-push.test.ts",
        "shader fallback push contract > failed-tile-survives-restore",
        r"""python3 - <<'PY'
from pathlib import Path
p = Path('web/src/graph/render-host.ts')
old = '''      if (slot.fallback && slot.compileFailed) {
        slot.latch.reset();
        continue;
      }'''
new = '''      if (slot.fallback && slot.compileFailed) {
        this.untrackFallback(slot.fallback);
        slot.fallback.dispose();
        slot.fallback = null;
        slot.mountedFallbackPackKey = "";
        slot.latch.reset();
        continue;
      }'''
t = p.read_text()
p.write_text(t.replace(old, new))
PY""",
    ),
    (
        "healthy-tile-ignores-push",
        "src/plugins/shader-fallback-push.test.ts",
        "shader fallback push contract > healthy-tile-ignores-push",
        r"""python3 - <<'PY'
from pathlib import Path
p = Path('web/src/graph/render-host.ts')
t = p.read_text().replace(
    '    if (!slot.fallback) return;\n    slot.fallback.pushPackText(trimmed);',
    '    if (!slot.fallback) this.mountShaderFallback(tileId);\n    slot.fallback?.pushPackText(trimmed);',
)
p.write_text(t)
PY""",
    ),
    (
        "staged-push-before-fail-immediate",
        "src/plugins/shader-fallback-push.test.ts",
        "shader fallback push contract > staged-push-before-fail-immediate",
        "sed -i '/slot.stagedPush = trimmed;/d' web/src/graph/render-host.ts",
    ),
    (
        "context-loss-notice-no-generic",
        "src/graph/shader-fallback-gl.test.ts",
        "shader fallback gl context > context-loss-notice-no-generic",
        "sed -i 's/this.gfxNotice.onContextLost();//' web/src/graph/render-host.ts",
    ),
    (
        "context-restore-recompile",
        "src/graph/shader-fallback-gl.test.ts",
        "shader fallback gl context > context-restore-recompile",
        r"""python3 - <<'PY'
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
t = p.read_text()
p.write_text(t.replace(old, new))
PY""",
    ),
    (
        "context-loss-no-restore-timeout",
        "src/graph/shader-fallback-gl.test.ts",
        "shader fallback gl context > context-loss-no-restore-timeout",
        r"""python3 - <<'PY'
from pathlib import Path
p = Path('web/src/graph/gfx-wall-notice.ts')
t = p.read_text()
t = t.replace('    this.restoreTimer = setTimeout(() => this.onRestoreTimeout(), 10_000);', '    this.restoreTimer = setTimeout(() => {}, 10_000);')
p.write_text(t)
PY""",
    ),
    (
        "gfx-notice-copy-literals",
        "src/graph/shader-fallback-gl.test.ts",
        "shader fallback gl context > gfx-notice-copy-literals",
        "sed -i 's/Graphics were interrupted/Was interrupted/' web/src/graph/shader-fallback-copy.ts",
    ),
    (
        "restore-resets-keys",
        "src/graph/shader-fallback-context-gen.test.ts",
        "shader fallback context gen > restore-resets-keys",
        "sed -i 's/prev.gen === next.gen && //' web/src/graph/context-cache-key.ts",
    ),
    (
        "no-gl-while-lost",
        "src/graph/shader-fallback-context-gen.test.ts",
        "shader fallback context gen > no-gl-while-lost",
        r"""sed -i '/if (this.glContextLost) return { x: x \* this.pr, y: y \* this.pr, w: w \* this.pr, h: h \* this.pr };/d' web/src/graph/render-host.ts""",
    ),
    (
        "listeners-once",
        "src/graph/shader-fallback-context-gen.test.ts",
        "shader fallback context gen > listeners-once",
        r"""python3 - <<'PY'
from pathlib import Path
p = Path('web/src/graph/render-host.ts')
t = p.read_text()
t = t.replace('  if (marked[GL_CONTEXT_LISTENERS_KEY]) return;\n  marked[GL_CONTEXT_LISTENERS_KEY] = true;\n', '')
extra = '''    attachGlContextListeners(
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
t = t.replace(
    '    this.contextGen = mintContextGen((this.contextGen as number) + 1);',
    '    this.contextGen = mintContextGen((this.contextGen as number) + 1);\n' + extra,
)
p.write_text(t)
PY""",
    ),
    (
        "loss-prevent-default",
        "src/graph/shader-fallback-context-gen.test.ts",
        "shader fallback context gen > loss-prevent-default",
        "sed -i 's/e.preventDefault();//' web/src/graph/render-host.ts",
    ),
    (
        "timer-cleared",
        "src/graph/shader-fallback-context-gen.test.ts",
        "shader fallback context gen > timer-cleared",
        r"""python3 - <<'PY'
from pathlib import Path
p = Path('web/src/graph/gfx-wall-notice.ts')
t = p.read_text().replace(
    '    if (this.restoreTimer) {\n      clearTimeout(this.restoreTimer);\n      this.restoreTimer = null;\n    }\n',
    '',
)
p.write_text(t)
PY""",
    ),
    (
        "late-restore-clears-reload",
        "src/graph/shader-fallback-gl.test.ts",
        "shader fallback gl context > late-restore-clears-reload",
        r"""python3 - <<'PY'
from pathlib import Path
p = Path('web/src/graph/gfx-wall-notice.ts')
t = p.read_text()
old = '''    const btn = this.el?.querySelector(`.${GFX_WALL_RELOAD_CLASS}`) as HTMLButtonElement | null;
    const focusOnReload = btn !== null && document.activeElement === btn;
    const hadLateReload = this.reloadOffered;
    this.el?.remove();
    this.el = null;
    this.shown = false;
    this.reloadOffered = false;
    if (focusOnReload) {
      this.wall.tabIndex = -1;
      this.wall.focus();
    }
    if (hadLateReload) this.opts.onDismissLateReload?.();'''
new = '''    const hadLateReload = this.reloadOffered;
    this.el?.remove();
    this.el = null;
    this.shown = false;
    this.reloadOffered = false;
    if (hadLateReload) this.opts.onDismissLateReload?.();'''
if old not in t:
    raise SystemExit('late-restore anchor missing')
p.write_text(t.replace(old, new))
PY""",
    ),
]


def main() -> None:
    DIR.mkdir(parents=True, exist_ok=True)
    for side in DIR.glob("*.sidecar.json"):
        side.unlink()
    failures: list[str] = []
    for row, test_file, test_name, mutate in ROWS:
        print(f"row {row}…", flush=True)
        code, out = vitest(test_file, test_name)
        if code != 0:
            failures.append(f"{row}: base test failed")
            continue
        try:
            patch = save_patch(mutate)
        except SystemExit as e:
            failures.append(f"{row}: {e}")
            git_reset()
            continue
        (DIR / f"{row}.patch").write_text(patch)
        code2, out2 = vitest(test_file, test_name)
        git_reset()
        if code2 == 0:
            failures.append(f"{row}: patched test still passed")
            continue
        try:
            red = extract_red(out2)
        except ValueError as e:
            failures.append(f"{row}: {e}")
            continue
        mkjson(row, test_file, test_name, red)
        print(f"  red={red}", flush=True)
    if failures:
        print("FAILURES:")
        for f in failures:
            print(" ", f)
        raise SystemExit(1)
    print("all rows ok")


if __name__ == "__main__":
    main()
