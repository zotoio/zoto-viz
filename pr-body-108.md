## #108 `cursor/dogfood-soak-52c-c58c` → `cursor/dogfood-soak-52b-c58c` (draft; replaces #97)

Dogfood soak **52c**: wall LIMITED harness, mosaic H6 status UX, backdrop/sky fragment tweak, cadence carry/gap proofs, and **12** revert rows under `revert-proofs/108/`.

### Production hunk → row

1. `web/src/app/main.ts` — `@@ -81,7 +81,11 @@ import {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
2. `web/src/app/main.ts` — `@@ -1049,12 +1053,7 @@ function feed(m: StateMsg): void {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
3. `web/src/core/viz-wall-limited-harness.ts` — `@@ -0,0 +1,201 @@` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
4. `web/src/graph/backdrop.ts` — `@@ -169,7 +169,8 @@ export function cycleSkyPool(): BackdropKind[] {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
5. `web/src/graph/backdrop.ts` — `@@ -177,6 +178,8 @@ void main() {` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
6. `web/src/graph/backdrop.ts` — `@@ -654,6 +657,26 @@ export { PLUGIN_SKY_UNIFORMS } from "../plugins/plugin-sky-uniforms";` → `JUSTIFICATION:integration wiring for this split (no single-hunk revert row)`
7. `web/src/plugins/viz-tile-budget.ts` — `@@ -322,6 +322,45 @@ export function resetVizTileBudgetLifecycle(): void {` → `shot-3-per-tile-mirror-revert`

### Kept revert rows

- `clock-w1-wall-dt`: W1 revert wall dt
- `mosaic-h6-boot-persist-revert`: Q1 boot refusal revert persistAnim deletes saved nine-tile key
- `mosaic-h6-no-guard`: H6 revert no applyAnim guard
- `nixie-fc-glsl-revert`: A7 nixie-clock GLSL: fc undeclared revert → 1 compile error
- `shot-3-per-tile-mirror-revert`: A7 Shot 3 revert: non-primary tiles keep delivered=0
- `shot-6-wall-shed-revert`: Shot 6 revert: wall shed clears non-primary tile lastDeliveredFrame
- `wall-budget-boundary-revert`: D budget boundary revert: 5010 ticks classified as over_budget (>= wall cap)
- `wall-cadence-carry-forward-revert`: Amendment 5 P1 carry-forward revert — cadence skip path stops incrementing skipped
- `wall-cadence-floor-plus-one-revert`: Amendment 5 P3 rounding revert — floor(N×cost/5010)+1 instead of ceil goes red at 2505 with 200 runs
- `wall-cadence-gap-revert`: Amendment 5 P2 even-gap revert — floor cadence shrinks build-gap count
- `wall-limited-label-ring-rate-revert`: Amendment 6 L2 revert — LIMITED label from live HUD ring skip rate
- `wall-limited-mosaic-line-revert`: B revert: LIMITED on mosaic tile lines instead of wall strip only

### Deleted rows

_None on this split._

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

`9 files changed, 790 insertions(+), 15 deletions(-)`
