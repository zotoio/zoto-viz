# Revert rows — stacked tile-health PR (base: #141)

| Row | Production revert |
|-----|-------------------|
| `tile-health-present-tick` | Remove present `tick` binding in `tile-health-present.ts` |
| `tile-health-context-lost-guard` | Restore #31 `gpuContextLost` scratch check path in `tile-health-monitor.ts` |
| `viz-hud-skip-null-tile` | Same as #141 — remove null guard in `VizHud.tick` mosaic loop |
