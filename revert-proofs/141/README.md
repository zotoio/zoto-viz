# Revert rows — PR #141

| Field | Value |
|-------|-------|
| `proven_at` | _(updated by `node scripts/revert-proof.mjs 141`)_ |
| `tree` | _(recorded at prove time)_ |

Three vitest rows revert production fixes in `viz-hud.ts` and `tile-health-present.ts`.

`scripts/revert-proof.mjs` does **not** support a `command` runner row; `tsconfig.test.json` compile coverage is enforced by the web `build` script (`tsc -p tsconfig.test.json --noEmit`).

## Tile-health history (git log -S)

| Symbol | Introduced / wired | Lost |
|--------|-------------------|------|
| `TileHealthMonitor` / `tileHealthRgba` | `37421a14`, refined `e8d1e3dc`, wired in `main.ts` | removed in catch-up `a2c7d39b` |
| shared readback | `fa8bfbb9` | — |
| `photo-sky-registry.ts` | never had a production importer | deleted (test-only) |
