<!-- Paste into PR #52b body (QE hunk-to-row gate) -->
## Hunk-to-row table (52b)

Every production hunk under `web/src` (not tests, not proofs) maps to a revert row or named test.

| Hunk | Sweep @ HEAD | Row or named test |
|------|----------------|-------------------|
| `web/src/app/main-viz-tile-lines.ts#0` | RED | revert: `f4-steady-revert` |
| `web/src/app/main.ts#3` | RED | test/row: syncVizBudgetTileScope |
| `web/src/app/main.ts#4` | RED | test/row: main-viz-ubo-wire.test.ts > afterLook broadcast |
| `web/src/app/main.ts#5` | RED | test/row: main-viz-ubo-wire.test.ts > bindVizWriter broadcast |
| `web/src/app/main.ts#6` | RED | test/row: main-viz-ubo-wire.test.ts > sandbox writeBuffer broadcast |
| `web/src/app/main.ts#7` | RED | test/row: mainVizDeliver feed path |
| `web/src/app/main.ts#8` | RED | test/row: main-viz-hud.test.ts > M2 |
| `web/src/app/main.ts#9` | RED | test/row: boot wall flags + nixie clock |
| `web/src/app/viz-main-deliver.ts#0` | RED | revert: `main-m1-wall-epoch-dt` |
| `web/src/core/viz-dev-wall-flags.ts#0` | RED | revert: `viz-wall-flag-reanchor-revert` |
| `web/src/core/viz-wall-limited-harness.ts#0` | RED | test: `src/core/viz-wall-limited-harness.test.ts` (+ sweep RED) |
| `web/src/graph/mosaic-viz-tile-guard.ts#0` | RED | test: `src/graph/mosaic-viz-tile-guard.test.ts` (+ sweep RED) |
| `web/src/plugins/dogfood-runner.ts#0` | RED | revert: `over-budget-pattern` |
| `web/src/plugins/dogfood-runner.ts#1` | RED | revert: `over-budget-pattern` |
| `web/src/plugins/dogfood-runner.ts#2` | RED | revert: `over-budget-pattern` |
| `web/src/plugins/dogfood-runner.ts#3` | RED | revert: `over-budget-pattern` |
| `web/src/plugins/dogfood-runner.ts#4` | RED | revert: `over-budget-pattern` |
| `web/src/plugins/dogfood-runner.ts#5` | RED | revert: `over-budget-pattern` |
| `web/src/plugins/dogfood-runner.ts#6` | RED | test/row: dogfood-runner-clock-wire.test.ts |
| `web/src/plugins/dogfood-runner.ts#7` | RED | revert: `over-budget-pattern` |
| `web/src/plugins/dogfood-tile-budget.ts#0` | RED | test: `src/plugins/viz-clock-imports.test.ts` (+ sweep RED) |
| `web/src/plugins/dogfood-tile-hud.ts#0` | RED | revert: `hud-skip-rate` |
| `web/src/plugins/viz-host.ts#4` | RED | revert: `clock-w1-wall-dt` |
| `web/src/plugins/viz-host.ts#5` | RED | revert: `clock-w1-wall-dt` |
| `web/src/plugins/viz-host.ts#6` | RED | revert: `clock-w1-wall-dt` |
| `web/src/plugins/viz-tile-budget.ts#0` | RED | revert: `wall-cadence-carry-forward-revert` |
| `web/src/plugins/viz-tile-constants.ts#0` | RED | test: `src/graph/mosaic-viz-tile-guard.test.ts` (+ sweep RED) |
| `web/src/plugins/viz-tile-hud.ts#0` | RED | revert: `tile-h3-inclusive-window` |
| `web/src/ui/tile-hud-label.ts#0` | RED | test: `src/ui/tile-hud-label.test.ts` (+ sweep RED) |
| `web/src/ui/viz-copy.ts#0` | RED | revert: `wall-limited-label-k-gate-revert` |
| `web/src/ui/viz-hud.ts#4` | RED | revert: `tile-r8-shedding-blank` |
| `web/src/ui/viz-hud.ts#5` | RED | revert: `tile-r8-shedding-blank` |
| `web/src/ui/viz-hud.ts#6` | RED | revert: `tile-r8-shedding-blank` |
| `web/src/ui/viz-hud.ts#7` | RED | revert: `tile-r8-shedding-blank` |

**Sweep:** `python3 revert-proofs/52/run-hunk-sweep.py` (must exit 0).
