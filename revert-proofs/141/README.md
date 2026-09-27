# Revert rows — PR #141

| Field | Value |
|-------|-------|
| `proven_at` | _(updated by `node scripts/revert-proof.mjs 141`)_ |
| `tree` | _(recorded at prove time)_ |

Two vitest rows revert production fixes in `viz-hud.ts` (nullable mosaic tile budget lines).

`scripts/revert-proof.mjs` does **not** support a `command` runner row; `tsconfig.test.json` compile coverage is enforced by the web **`build`** script (`tsc -p tsconfig.test.json --noEmit`).

## `photo-sky-registry.ts`

`git log -S photo-sky-registry` / `assertPhotoSkyRegistry` show no production importer on `main` @ `6c67ab08` (test-only). Removed in this PR.

## Tile-health

`tile-health-monitor.ts` and `NetScene` readback getters stay for the stacked **#31 wiring PR**; production wiring is **not** in #141.
