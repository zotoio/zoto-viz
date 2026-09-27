## #107 `cursor/dogfood-soak-52b-c58c` → `cursor/dogfood-soak-52a-c58c` (draft; replaces #98)

Dogfood soak **52b**: tile budget registry, dev `viz` wall flags, HUD LIMITED copy/lines, main deliver + present-opts wiring, and **30** revert rows under `revert-proofs/107/` (includes `budget-too-strict` + `viz-clock-import-vizWallMs` moved from 52a).

### Production hunk → row

1. `web/src/app/main-present-opts-localstorage.ts` — `@@ -0,0 +1,51 @@` → `main-present-opts-localstorage-revert`
2. `web/src/app/main-viz-tile-lines.ts` — `@@ -0,0 +1,44 @@` → `f4-steady-revert`
3. `web/src/app/main.ts` — `@@ -71,8 +71,7 @@ import { resolvePluginWall, type WallSnap } from "../plugins/plugin-wall";` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
4. `web/src/app/main.ts` — `@@ -80,7 +79,9 @@ import {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
5. `web/src/app/main.ts` — `@@ -96,7 +97,12 @@ import { ignoreResizeLoopError, observeResize } from "../core/resize";` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
6. `web/src/app/main.ts` — `@@ -346,6 +352,21 @@ const pluginSfx = new PluginSfx();` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
7. `web/src/app/main.ts` — `@@ -1001,22 +1022,40 @@ function feed(m: StateMsg): void {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
8. `web/src/app/main.ts` — `@@ -1027,6 +1066,11 @@ function feed(m: StateMsg): void {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
9. `web/src/app/main.ts` — `@@ -1034,6 +1078,9 @@ function feed(m: StateMsg): void {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
10. `web/src/app/main.ts` — `@@ -1075,7 +1122,11 @@ function setRedaction(on: boolean): void {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
11. `web/src/app/viz-main-deliver.ts` — `@@ -0,0 +1,42 @@` → `main-m1-wall-epoch-dt`
12. `web/src/core/viz-dev-wall-flags.ts` — `@@ -0,0 +1,97 @@` → `dev-cost-off-revert`
13. `web/src/graph/mosaic-viz-tile-guard.ts` — `@@ -0,0 +1,68 @@` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
14. `web/src/graph/mosaic.ts` — `@@ -12,6 +12,8 @@ import {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
15. `web/src/graph/mosaic.ts` — `@@ -499,6 +501,7 @@ export class Mosaic {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
16. `web/src/graph/mosaic.ts` — `@@ -1034,6 +1037,7 @@ export class Mosaic {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
17. `web/src/plugins/dogfood-runner.ts` — `@@ -1,6 +1,7 @@` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
18. `web/src/plugins/dogfood-runner.ts` — `@@ -328,8 +329,10 @@ export function runDogfoodSoak(opts: DogfoodSoakOptions = {}): DogfoodSoakResult` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
19. `web/src/plugins/dogfood-runner.ts` — `@@ -413,7 +416,9 @@ export function runPackSwapPreserve(` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
20. `web/src/plugins/dogfood-tile-budget.ts` — `@@ -0,0 +1,127 @@` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
21. `web/src/plugins/dogfood-tile-hud.ts` — `@@ -0,0 +1,89 @@` → `hud-skip-rate`
22. `web/src/plugins/host.ts` — `@@ -1,3 +1,4 @@` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
23. `web/src/plugins/host.ts` — `@@ -81,6 +82,7 @@ export class PluginSandbox {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
24. `web/src/plugins/viz-host.ts` — `@@ -1,6 +1,8 @@` → `budget-too-strict`
25. `web/src/plugins/viz-host.ts` — `@@ -466,10 +468,18 @@ export class VizFrameBudget {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
26. `web/src/plugins/viz-host.ts` — `@@ -488,7 +498,6 @@ export class VizFrameBudget {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
27. `web/src/plugins/viz-host.ts` — `@@ -512,8 +521,8 @@ export class VizFrameBudget {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
28. `web/src/plugins/viz-host.ts` — `@@ -522,16 +531,33 @@ export class VizFrameBudget {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
29. `web/src/plugins/viz-host.ts` — `@@ -541,6 +567,19 @@ export class VizFrameBudget {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
30. `web/src/plugins/viz-tile-budget.ts` — `@@ -0,0 +1,332 @@` → `f4-rebuild-revert`
31. `web/src/plugins/viz-tile-constants.ts` — `@@ -0,0 +1,23 @@` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
32. `web/src/plugins/viz-tile-hud.ts` — `@@ -0,0 +1,142 @@` → `tile-h1a-no-wall-fit`
33. `web/src/ui/settings.ts` — `@@ -27,6 +27,9 @@ import {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
34. `web/src/ui/settings.ts` — `@@ -125,6 +128,14 @@ export class Settings {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
35. `web/src/ui/settings.ts` — `@@ -260,8 +271,21 @@ export class Settings {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
36. `web/src/ui/settings.ts` — `@@ -930,6 +954,7 @@ export class Settings {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
37. `web/src/ui/settings.ts` — `@@ -962,6 +987,7 @@ export class Settings {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
38. `web/src/ui/settings.ts` — `@@ -970,6 +996,7 @@ export class Settings {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
39. `web/src/ui/settings.ts` — `@@ -1702,7 +1729,7 @@ export class Settings {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
40. `web/src/ui/settings.ts` — `@@ -1712,12 +1739,67 @@ export class Settings {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
41. `web/src/ui/settings.ts` — `@@ -2035,7 +2117,9 @@ export class Settings {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
42. `web/src/ui/tile-hud-label.ts` — `@@ -0,0 +1,63 @@` → `tile-d1-schedule-revert`
43. `web/src/ui/viz-copy.ts` — `@@ -0,0 +1,54 @@` → `wall-cadence-ordinal-naive-revert`
44. `web/src/ui/viz-hud.ts` — `@@ -1,5 +1,9 @@` → `tile-r8-shedding-blank`
45. `web/src/ui/viz-hud.ts` — `@@ -72,6 +76,32 @@ export interface VizHudTick {` → `viz-hud-write-steady-revert`
46. `web/src/ui/viz-hud.ts` — `@@ -173,6 +203,7 @@ export class VizHud {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
47. `web/src/ui/viz-hud.ts` — `@@ -182,6 +213,16 @@ export class VizHud {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
48. `web/src/ui/viz-hud.ts` — `@@ -208,6 +249,10 @@ export class VizHud {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
49. `web/src/ui/viz-hud.ts` — `@@ -226,12 +271,24 @@ export class VizHud {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
50. `web/src/ui/viz-hud.ts` — `@@ -251,12 +308,41 @@ export class VizHud {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
51. `web/src/ui/viz-hud.ts` — `@@ -272,7 +358,44 @@ export class VizHud {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`

### Kept revert rows

- `budget-too-strict`: budget honesty revert silent green on skip
- `dev-cost-off-revert`: F4 dev flag off revert injector
- `dev-wall-cost-index-form-revert`: A revert: whole-wall flag accepts index:ticks again
- `dev-wall-cost-strict-revert`: Q3 revert: whole-wall cost accepts 1e3 via Number()
- `dev-wall-flags-bad-clock-revert`: F5 (iii) revert wall clock drops HH:MM range check
- `dev-wall-flags-parse-steady-revert`: F5 (i) revert dev flags parsed every steady frame
- `f4-rebuild-revert`: F4 rebuild revert tile release
- `f4-steady-revert`: F4 steady revert per-frame tile line allocations
- `hud-skip-rate`: HUD skip rate revert inclusive lower bound in sim
- `main-m1-wall-epoch-dt`: M1 revert epoch frame.t as viz clock
- `main-present-opts-localstorage-revert`: W4 revert optsFor cache removed — extra localStorage per steady frame
- `nixie-local-wall-utc-revert`: Real local wall Sydney 01:05 uses getHours not UTC
- `tile-d1-schedule-revert`: D1 schedule revert compare-before-write
- `tile-d1-steady-revert`: D1 steady revert LIMITED label cache
- `tile-h1a-no-wall-fit`: H1 revert A without wall-fit over_budget
- `tile-h1b-flat-share`: H1 revert B flat tile share
- `tile-h3-inclusive-window`: H3 revert inclusive HUD window lower bound
- `tile-h4-last-build-only`: H4 revert
- `tile-h5-no-fallback`: H5 revert
- `tile-h6-no-clamp`: H6 revert
- `tile-r1-skip-one`: tile-r1-skip-one
- `tile-r2-no-cap`: tile-r2-no-cap
- `tile-r3-no-floor`: tile-r3-no-floor
- `tile-r8-shedding-blank`: R8 revert shedding blanks HUD frame
- `viz-clock-import-vizWallMs`: import lint revert vizWallMs in budget
- `viz-hud-write-steady-revert`: W4 revert HUD metric textContent every frame
- `viz-wall-clock-prod-inert-revert`: F5 (vi) revert prod honors vizWallClock query
- `viz-wall-flag-reanchor-revert`: Q4 flag clock revert re-anchors on wall rebuild
- `wall-cadence-ordinal-naive-revert`: Amendment 6 L3 revert — naive k % 10 ordinals (11th wrong)
- `wall-limited-label-k-gate-revert`: Amendment 6a revert — drop k >= 2 gate shows every 1st frame

### Deleted rows

_None on this split (deletions listed on #96)._

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

`49 files changed, 2836 insertions(+), 99 deletions(-)`
