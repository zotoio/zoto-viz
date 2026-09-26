<!-- Paste into PR #52a body (QE hunk-to-row gate) -->
## Hunk-to-row table (52a)

Every production hunk under `web/src` (not tests, not proofs) maps to a revert row or named test.

| Hunk | Sweep @ HEAD | Row or named test |
|------|----------------|-------------------|
| `web/src/app/main-present-opts-localstorage.ts#0` | RED | test: `src/app/main-present-opts-localstorage.test.ts` (+ sweep RED) |
| `web/src/app/main.ts#0` | RED | test/row: main import trim (viz-host re-exports) |
| `web/src/app/main.ts#1` | RED | test/row: viz-main-deliver + tile budget imports |
| `web/src/app/main.ts#2` | RED | test/row: nixie boot + dev wall flags + main-viz-tile-lines |
| `web/src/app/viz-plugin-ubo.ts#0` | RED | test: `src/app/viz-plugin-ubo.test.ts` (+ sweep RED) |
| `web/src/core/viz-clock.ts#0` | RED | test: `src/plugins/dogfood-tile-hud.test.ts` (+ sweep RED) |
| `web/src/core/viz-time.ts#0` | RED | test: `src/plugins/viz-host.test.ts` (+ sweep RED) |
| `web/src/graph/mosaic.ts#0` | RED | test/row: mosaic-viz-tile-sync.test.ts |
| `web/src/graph/mosaic.ts#1` | RED | test/row: mosaic-viz-tile-sync.test.ts |
| `web/src/graph/mosaic.ts#2` | RED | test/row: mosaic-viz-tile-sync.test.ts |
| `web/src/graph/mosaic.ts#3` | RED | test/row: mosaic-viz-tile-sync.test.ts |
| `web/src/graph/render-host.ts#0` | RED | test: `src/graph/webgl.test.ts` (+ sweep RED) |
| `web/src/graph/render-host.ts#1` | RED | test: `src/graph/webgl.test.ts` (+ sweep RED) |
| `web/src/graph/render-host.ts#2` | RED | test: `src/graph/webgl.test.ts` (+ sweep RED) |
| `web/src/graph/render-host.ts#3` | RED | test: `src/graph/webgl.test.ts` (+ sweep RED) |
| `web/src/plugins/fixtures/viz-sdk-frame-build.ts#0` | RED | test: `src/plugins/fixtures/viz-vm-live-capture.test.ts` (+ sweep RED) |
| `web/src/plugins/fixtures/viz-sdk-frame-build.ts#1` | RED | test: `src/plugins/fixtures/viz-vm-live-capture.test.ts` (+ sweep RED) |
| `web/src/plugins/fixtures/viz-sdk-frame-build.ts#2` | RED | test: `src/plugins/fixtures/viz-vm-live-capture.test.ts` (+ sweep RED) |
| `web/src/plugins/fixtures/viz-sdk-frame-build.ts#3` | RED | test: `src/plugins/fixtures/viz-vm-live-capture.test.ts` (+ sweep RED) |
| `web/src/plugins/host.ts#0` | RED | test/row: host-scope-wire.test.ts |
| `web/src/plugins/host.ts#1` | RED | test/row: host-scope-wire.test.ts |
| `web/src/plugins/nixie-wall-broadcast.ts#0` | RED | test: `src/plugins/nixie-wall-clock-source-rows.test.ts` (+ sweep RED) |
| `web/src/plugins/nixie-wall-clock.ts#0` | RED | revert: `nixie-n2-cache-offset` |
| `web/src/plugins/nixie-wall-parts.ts#0` | RED | revert: `nixie-wall-flag-no-midnight-wrap-revert` |
| `web/src/plugins/nixie-wall-upload.ts#0` | RED | revert: `nixie-f1-off-revert` |
| `web/src/plugins/typesafe-host.ts#0` | RED | test/row: typesafe-host-clock-wire.test.ts |
| `web/src/plugins/typesafe-host.ts#1` | RED | test/row: typesafe-host-clock-wire.test.ts |
| `web/src/plugins/typesafe-host.ts#2` | RED | test/row: typesafe-host-clock-wire.test.ts |
| `web/src/plugins/typesafe-host.ts#3` | RED | test/row: typesafe-host-clock-wire.test.ts |
| `web/src/plugins/typesafe-host.ts#4` | RED | test/row: typesafe-host-clock-wire.test.ts |
| `web/src/plugins/typesafe-host.ts#5` | RED | test/row: typesafe-host-clock-wire.test.ts |
| `web/src/plugins/typesafe-host.ts#6` | RED | test/row: typesafe-host-clock-wire.test.ts |
| `web/src/plugins/viz-host.ts#0` | RED | revert: `clock-w1-wall-dt` |
| `web/src/plugins/viz-host.ts#1` | RED | revert: `clock-w1-wall-dt` |
| `web/src/plugins/viz-host.ts#2` | RED | revert: `clock-w1-wall-dt` |
| `web/src/plugins/viz-host.ts#3` | RED | revert: `clock-w1-wall-dt` |
| `web/src/plugins/viz-pack-host.ts#0` | RED | revert: `nixie-n1-format-every-frame` |
| `web/src/plugins/viz-pack-host.ts#1` | RED | revert: `nixie-n1-format-every-frame` |
| `web/src/plugins/viz-pack-host.ts#2` | RED | revert: `nixie-n1-format-every-frame` |
| `web/src/plugins/viz-pack-host.ts#3` | RED | revert: `nixie-n1-format-every-frame` |
| `web/src/ui/settings.ts#0` | RED | revert: `mosaic-h6-boot-persist-revert` |
| `web/src/ui/settings.ts#1` | RED | revert: `mosaic-h6-boot-persist-revert` |
| `web/src/ui/settings.ts#2` | RED | revert: `mosaic-h6-boot-persist-revert` |
| `web/src/ui/settings.ts#3` | RED | revert: `mosaic-h6-boot-persist-revert` |
| `web/src/ui/settings.ts#4` | RED | revert: `mosaic-h6-boot-persist-revert` |
| `web/src/ui/settings.ts#5` | RED | revert: `mosaic-h6-boot-persist-revert` |
| `web/src/ui/settings.ts#6` | RED | revert: `mosaic-h6-boot-persist-revert` |
| `web/src/ui/settings.ts#7` | RED | revert: `mosaic-h6-boot-persist-revert` |
| `web/src/ui/settings.ts#8` | RED | revert: `mosaic-h6-boot-persist-revert` |
| `web/src/ui/viz-hud.ts#0` | RED | revert: `tile-r8-shedding-blank` |
| `web/src/ui/viz-hud.ts#1` | RED | revert: `tile-r8-shedding-blank` |
| `web/src/ui/viz-hud.ts#2` | RED | revert: `tile-r8-shedding-blank` |
| `web/src/ui/viz-hud.ts#3` | RED | revert: `tile-r8-shedding-blank` |

**Sweep:** `python3 revert-proofs/52/run-hunk-sweep.py` (must exit 0).
