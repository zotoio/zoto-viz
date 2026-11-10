# Rocket Car Soccer

Self-playing boost-car arena visual for zoto-viz. Original procedural stadium, teams, cars, and physics — no real car brands, logos, or trademarks. The optional HD model set uses CC0 textures only (see `ASSETS.md`).

## Layout

- `plugin.yml` — id `rocket-car-soccer`, viz contract (3×64-float buffers), datasource streams
- `visualisation.yml` — stage-only look, presets, seed, min director cut seconds
- `frontend/match.ts` — fixed-timestep sim (accumulator + max 4 substeps @ 120 Hz), replay ring (no re-sim)
- `frontend/live.ts` — monitor fields → boost / goal pulse / Zoto Fail alerts
- `frontend/pools.ts` — pre-allocated particle and trail pools
- `frontend/pack.ts` — options, presets, caps
- `frontend/index.ts` — sandbox driver (`config.read`, `viz.write`, `writeBuffer`, `writeParticles`)
- `sky/fragment.glsl` — raymarched arena + tile-legible scoreboard / fail strip / demo label
- `assets/` — Standard designer GLBs, the `-hd` set and `env-hd.jpg`; `blender/` builds the HD set (`ASSETS.md`)

## Live mapping

| Field | Effect |
|-------|--------|
| `talkers.rate` | Car boost fill |
| `packets.field` | Stadium goal-line pulse on the ball (max field across consumed packets) |
| `sys.failed` | Zoto Fail scoreboard alert (never covered by goal FX) |
| `sys.udev` | Random car jump pulses |

Idle host fixture keeps a lively demo match; HUD `demoFlag` drives the on-sky **demo** marker.

Talker **`id`** binds stable car slots (list reorder does not reassign cars). Departed talkers keep their slot reserved briefly.

Failures are **stadium-wide** from `sys.failed` only (scoreboard / HUD strip), never tied to a car, team, packet `field`, or headline text.

## Presets

| Id | Intent |
|----|--------|
| `broadcast` | Day stadium, side camera, calm cuts |
| `neon_night` | Neon trim, spark trails, faster director |
| `chaos_3v3` | 3v3, high speed and aggression |
| `chill_orbit` | 2v2, slow orbit, softer particles |

Use the **preset** select in This view, then tune individual sliders. Randomise, Undo, and Reset live in the host settings panel (not in this pack’s config).

## Model set (Standard / HD)

**model set** in This view picks the host-mesh assets. **Standard** (the default) draws the original designer GLBs.
**HD** swaps in `rocket-car-hd`, `rocket-car-blue-hd` and `soccer-ball-hd`, and lights them with the `env-hd`
stadium environment (Poly Haven Orlando Stadium, CC0). Node names, wheel spin and booster flame are the same in
both sets.

- Cars: a two-tone clearcoat livery (team colour over graphite, twin white stripes, a race-number door panel)
  over a baked panel-line normal, team-colour light strips on the skirts and tail, glowing hubs and calipers,
  photographed carbon-fibre trim, tread and sidewall tyres, and polished metal rims.
- Ball: a 32-panel stitched leather ball, white hexagons and black pentagons (Poly Haven Leather White grain,
  deep recessed seams, stitch rows).
- Budget: about 285 KB per car and 76 KB for the ball. Textures plus the environment PMREM fit the 8 MiB
  `maxGpuBytes` ceiling, versus about 17 MB of textures for Standard.

Rebuild with `blender --python blender/build_rocket_car_hd.py -- --out plugins/src/rocket-car-soccer` in a visible Blender (steps in `ASSETS.md`).

## Tests

From repo root:

```bash
python3 -m pytest tests/test_rocket_car_soccer_pack.py -q
```

Pack vitest (also invoked by the pytest above):

```bash
./web/node_modules/.bin/vitest run --config plugins/src/rocket-car-soccer/vitest.config.cjs
```

Python schema + shader stamp (when available):

```bash
python -m service.plugins validate plugins/src/rocket-car-soccer
```

## Limits (`RCS_CAPS` in `frontend/pack.ts`)

- Max 6 cars (3 per team)
- 48 pooled particles / 24 trail segments
- 4 physics substeps per frame
- Render scale fixed at `1.0` via `rcsRenderScale()` until the host governor ships

## CSP / sandbox

Runs entirely in the consented plugin iframe and whitelisted sky uniforms. No fetches, workers, or DOM — compatible with default CSP and `sandbox="allow-scripts"`.

## Wall layout (QE)

Place the pack on a saved mosaic tile (not the VIEW dropdown while CSP blocks sandbox bootstrap). Example snippet for one tile on a 4×4 wall:

```yaml
mosaic:
  cols: 4
  rows: 4
  tiles:
    - col: 0
      row: 0
      view: rocket-car-soccer
      preset: broadcast
      seed: "42"
```

Consent: enable plugin consent for `rocket-car-soccer` before capture.
