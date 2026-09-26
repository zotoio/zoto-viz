# Rocket Car Soccer

Self-playing boost-car arena visual for zoto-viz. Original procedural stadium, teams, and physics — no third-party assets or trademarks.

## Layout

- `plugin.yml` — id `rocket-car-soccer`, `liveMapping`, hard `caps`, viz contract (3×64-float buffers)
- `visualisation.yml` — stage-only look, presets, seed, min director cut seconds
- `frontend/match.ts` — fixed-timestep sim (accumulator + max 4 substeps @ 120 Hz), replay ring (no re-sim)
- `frontend/live.ts` — monitor fields → boost / goal pulse / Zoto Fail alerts
- `frontend/pools.ts` — pre-allocated particle and trail pools
- `frontend/pack.ts` — options, presets, caps, undo/randomise helpers
- `frontend/index.ts` — sandbox driver (`config.read`, `viz.write`, `writeBuffer`, `writeParticles`)
- `sky/fragment.glsl` — raymarched arena + tile-legible scoreboard / fail strip / demo label

## Live mapping

| Field | Effect |
|-------|--------|
| `talkers.rate` | Car boost fill |
| `packets.field` | Goal-line pulse on the ball |
| `sys.failed` | Zoto Fail scoreboard alert (never covered by goal FX) |
| `sys.udev` | Random car jump pulses |

Idle host fixture keeps a lively demo match; HUD `demoFlag` drives the on-sky **demo** marker.

## Presets

| Id | Intent |
|----|--------|
| `broadcast` | Day stadium, side camera, calm cuts |
| `neon_night` | Neon trim, spark trails, faster director |
| `chaos_3v3` | 3v3, high speed and aggression |
| `chill_orbit` | 2v2, slow orbit, softer particles |

Use the **preset** select in This view, or **dice → Randomise / Undo / Reset** for live tweaks.

## Tests

From `web/`:

```bash
pnpm exec vitest run src/plugins/rocket-car-soccer.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
```

Python schema + shader stamp (when available):

```bash
python -m service.plugins validate plugins/src/rocket-car-soccer
```

## Limits (plugin.yml `caps`)

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
