## #96 `cursor/dogfood-soak-52a-c58c` → `main` (draft)

Dogfood soak **52a**: viz wall clock (`viz-clock` / `viz-time`), nixie wall + pack-host hardening, render-host buffer freshness, mosaic guard hooks, and **15** revert rows under `revert-proofs/96/` (Amendment 9: folder name = PR number). Tile budget, dev wall flags, HUD copy/labels, and main deliver wiring live on **52b**.

### Production hunk → row

1. `web/src/app/main.ts` — `@@ -80,7 +80,7 @@ import {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
2. `web/src/app/main.ts` — `@@ -89,12 +89,16 @@ import { stereoAiFrame } from "../plugins/stereo-ai";` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
3. `web/src/app/main.ts` — `@@ -340,7 +344,7 @@ let settings!: Settings;` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
4. `web/src/app/main.ts` — `@@ -381,7 +385,7 @@ scene.afterLook = () => {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
5. `web/src/app/main.ts` — `@@ -408,19 +412,19 @@ scene.afterLook = () => {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
6. `web/src/app/main.ts` — `@@ -431,7 +435,7 @@ sandbox.handlers = {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
7. `web/src/app/main.ts` — `@@ -998,12 +1002,13 @@ function feed(m: StateMsg): void {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
8. `web/src/app/main.ts` — `@@ -1011,8 +1016,8 @@ function feed(m: StateMsg): void {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
9. `web/src/app/main.ts` — `@@ -1028,7 +1033,7 @@ function feed(m: StateMsg): void {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
10. `web/src/app/main.ts` — `@@ -1069,6 +1074,9 @@ function setRedaction(on: boolean): void {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
11. `web/src/app/viz-plugin-ubo.ts` — `@@ -0,0 +1,15 @@` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
12. `web/src/core/viz-clock.ts` — `@@ -0,0 +1,83 @@` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
13. `web/src/core/viz-time.ts` — `@@ -0,0 +1,38 @@` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
14. `web/src/graph/mosaic.ts` — `@@ -12,7 +12,6 @@ import {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
15. `web/src/graph/mosaic.ts` — `@@ -215,7 +214,16 @@ export class Mosaic {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
16. `web/src/graph/render-host.ts` — `@@ -39,6 +39,15 @@ export interface HostedView {` → `render-host-buffer-fresh`
17. `web/src/graph/render-host.ts` — `@@ -74,6 +83,7 @@ export class RenderHost {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
18. `web/src/graph/render-host.ts` — `@@ -145,6 +155,13 @@ export class RenderHost {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
19. `web/src/graph/render-host.ts` — `@@ -257,5 +274,7 @@ export class RenderHost {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
20. `web/src/plugins/dogfood-runner.ts` — `@@ -1,4 +1,6 @@` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
21. `web/src/plugins/dogfood-runner.ts` — `@@ -154,7 +156,7 @@ export function percentile(samples: number[], p: number): number {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
22. `web/src/plugins/dogfood-runner.ts` — `@@ -162,9 +164,9 @@ export function dogfoodTick(` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
23. `web/src/plugins/dogfood-runner.ts` — `@@ -176,7 +178,7 @@ export function dogfoodTick(` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
24. `web/src/plugins/dogfood-runner.ts` — `@@ -220,11 +222,56 @@ export function hudTickFromBudget(` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
25. `web/src/plugins/dogfood-runner.ts` — `@@ -240,86 +287,116 @@ export function dogfoodWithinBudget(` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
26. `web/src/plugins/dogfood-runner.ts` — `@@ -327,7 +404,7 @@ export function runPackSwapPreserve(` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
27. `web/src/plugins/dogfood-runner.ts` — `@@ -337,28 +414,27 @@ export function runPackSwapPreserve(` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
28. `web/src/plugins/fixtures/viz-sdk-frame-build.ts` — `@@ -1,3 +1,4 @@` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
29. `web/src/plugins/fixtures/viz-sdk-frame-build.ts` — `@@ -427,7 +428,7 @@ export function vmLiveCaptureState(): StateMsg {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
30. `web/src/plugins/fixtures/viz-sdk-frame-build.ts` — `@@ -470,7 +471,7 @@ function scrubIdleDemoSlices(frame: VizDataFrame): VizDataFrame {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
31. `web/src/plugins/fixtures/viz-sdk-frame-build.ts` — `@@ -483,13 +484,13 @@ function scrubIdleDemoSlices(frame: VizDataFrame): VizDataFrame {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
32. `web/src/plugins/nixie-wall-broadcast.ts` — `@@ -0,0 +1,30 @@` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
33. `web/src/plugins/nixie-wall-clock.ts` — `@@ -0,0 +1,150 @@` → `nixie-n1-linear-wall`
34. `web/src/plugins/nixie-wall-flag-test-helper.ts` — `@@ -0,0 +1,11 @@` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
35. `web/src/plugins/nixie-wall-parts.ts` — `@@ -0,0 +1,82 @@` → `nixie-wall-flag-no-midnight-wrap-revert`
36. `web/src/plugins/nixie-wall-upload.ts` — `@@ -0,0 +1,39 @@` → `nixie-f1-off-revert`
37. `web/src/plugins/typesafe-host.ts` — `@@ -1,4 +1,5 @@` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
38. `web/src/plugins/typesafe-host.ts` — `@@ -272,8 +273,8 @@ export class TypeSafeHost {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
39. `web/src/plugins/typesafe-host.ts` — `@@ -281,7 +282,7 @@ export class TypeSafeHost {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
40. `web/src/plugins/typesafe-host.ts` — `@@ -294,7 +295,7 @@ export class TypeSafeHost {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
41. `web/src/plugins/typesafe-host.ts` — `@@ -308,7 +309,7 @@ export class TypeSafeHost {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
42. `web/src/plugins/typesafe-host.ts` — `@@ -327,7 +328,7 @@ export class TypeSafeHost {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
43. `web/src/plugins/typesafe-host.ts` — `@@ -337,7 +338,7 @@ export class TypeSafeHost {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
44. `web/src/plugins/viz-host.ts` — `@@ -1,4 +1,6 @@` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
45. `web/src/plugins/viz-host.ts` — `@@ -413,9 +415,18 @@ function packetSamples(state: StateMsg, limit: number): VizPacketSample[] {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
46. `web/src/plugins/viz-host.ts` — `@@ -439,12 +450,12 @@ export function buildVizFrame(state: StateMsg, prevTs = 0, audio = 0, bind?: Sou` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
47. `web/src/plugins/viz-host.ts` — `@@ -457,7 +468,7 @@ export class VizFrameBudget {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
48. `web/src/plugins/viz-host.ts` — `@@ -506,13 +517,13 @@ export class VizFrameBudget {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
49. `web/src/plugins/viz-pack-host.ts` — `@@ -1,3 +1,8 @@` → `nixie-f1-on-revert`
50. `web/src/plugins/viz-pack-host.ts` — `@@ -6,7 +11,76 @@ import {` → `nixie-n1-format-every-frame`
51. `web/src/plugins/viz-pack-host.ts` — `@@ -199,14 +273,22 @@ export function runPackFrameHandler(` → `nixie-n1-pack-canvas-fresh`

### Kept revert rows

- `nixie-f1-off-revert`: F1 off revert upload on frameIndex % 60
- `nixie-f1-on-revert`: F1 on revert upload every frame
- `nixie-n1-format-every-frame`: N1 revert format every frame
- `nixie-n1-linear-wall`: N1 revert linear wall ms
- `nixie-n1-pack-canvas-fresh`: N1 revert fresh canvas object in pack-host
- `nixie-n1-pack-parse-every-frame`: N1 revert per-frame parseNixieLook in pack-host
- `nixie-n1-stable-key-stringify`: N1 revert nixieOptsStableKey per-frame stringify
- `nixie-n12-hour12-on-boundary`: N12 revert hour12 blank tens digit
- `nixie-n2-cache-offset`: N2 revert
- `nixie-n3-uptime-clock`: N3 revert uptime clock
- `nixie-n4-drop-flicker-slot`: N4 revert drop flicker from slot comparison
- `nixie-wall-flag-no-midnight-wrap-revert`: B1 row 11 flag clock revert no midnight wrap
- `nixie-wall-flag-second-per-frame-revert`: B1 row 10 flag clock revert one second per frame
- `nixie-wall-real-date-every-frame-revert`: B1 row 9 real clock revert new Date every frame
- `render-host-buffer-fresh`: RH1 revert fresh bufferPixelSize object

### Deleted rows

| row | reason |
|-----|--------|
| `over-budget-pattern` | #101 soak; not in stack |
| `real-clock-hn-term` | #101 handoff; no stack fat-LAN/`termNow` row |
| `nixie-wall-flag-epoch-revert` | orphan (no apply target) |
| `hunk-sweep-results.json` | generated artifact |
| `budget-too-strict` (was 52a) | moved with tile budget slice to 52b |
| `viz-clock-import-vizWallMs` (was 52a) | moved with `viz-tile-budget.ts` to 52b |

### Gates

| ref | HEAD | TREE | ls-remote | porcelain | tsc | build | vitest | pytest |
|-----|------|------|-----------|-----------|-----|-------|--------|--------|
| main | `6520b014472c05f831ac5204429be2affb8473cb` | `75f428d6d893cce739a3f90a6fb3e1f8942e6c8f` | match | clean at gate ref | 0 | 0 | — | — |
| 52a | `30518e5ec9256beec751d5cfd297b9256ea0d5e4` | `c1aea8d4962c4ff2b06f519727075e2f4543e5cf` | match | untracked helper scripts/logs only | 0 | 0 | 686 passed | 433 passed |
| 52b | `486e9b2ce4b502d9b6faac2120b14cb55fdbdd95` | `481488693db02a34751383331579934b694bd8a4` | match | untracked helper scripts/logs only | 0 | 0 | 760 passed | 433 passed |
| 52c | `ed9f2b2f509ac7745856e02db12d179f8945f26c` | `691f628dd331ab8172b6e391afd2b93f4029efa4` | match | untracked helper scripts/logs only | 0 | 0 | 779 passed | 433 passed |

### Amendment 9 (`revert-proofs/<PR#>/`)

| PR | `git diff --stat <base>...HEAD -- revert-proofs/` touches only |
|----|------------------------------------------------------------------|
| #96 | `revert-proofs/96/` |
| #107 | `revert-proofs/107/` (inherits `96/` via merge; not in PR diff) |
| #108 | `revert-proofs/108/` (inherits `96/`, `107/` via merge) |

Row proofs: every `*.patch` under the PR folder passes `git apply --check` (zero offset, zero fuzz) at each head. See `revert-proofs/<PR>/README.md` for `proven_at` + `tree`.

### Size (excluding `revert-proofs/`)

`37 files changed, 1687 insertions(+), 197 deletions(-)`
