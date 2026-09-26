# Rocket Car Soccer

Self-playing boost-car arena visual for zoto-viz. Original procedural stadium, teams, and physics — no third-party assets or trademarks.

## Layout

- `plugin.yml` — id `rocket-car-soccer`, viz contract (3×64-float buffers)
- `visualisation.yml` — stage-only look, presets, and This-view knobs
- `frontend/match.ts` — fixed-timestep sim (cap 4 substeps @ 120 Hz)
- `frontend/pack.ts` — options, presets, caps, undo/randomise helpers
- `frontend/index.ts` — sandbox driver (`config.read`, `viz.write`)
- `sky/fragment.glsl` — raymarched arena, cars, ball, crowd, scoreboard

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
```

Python schema + shader stamp:

```bash
python -m service.plugins validate plugins/src/rocket-car-soccer
```

## Limits

- Max 3 players per team (6 cars)
- Particle density capped at 48 instances in sim / 16 packed for the sky
- Physics substeps capped at 4 per frame
- Render scale fixed at `1.0` via `rcsRenderScale()` until the host governor ships

## CSP / sandbox

Runs entirely in the consented plugin iframe and whitelisted sky uniforms. No fetches, workers, or DOM — compatible with default CSP and `sandbox="allow-scripts"`.
