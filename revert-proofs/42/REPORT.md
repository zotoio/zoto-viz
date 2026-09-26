# PR #42 split A — revert proof report

- **Base:** `6520b014472c05f831ac5204429be2affb8473cb` (`main`)
- **Stack A:** `cursor/wall-duplicate-pack-tiles-d355` (see git head on branch)
- **Stack A2:** `#81` `cursor/pack-mirror-readback-harness-d355` (frame-alloc / frame-loop / gpu-pack-present / mosaic-coalesce unit tests)

## Size (vs `origin/main`, excluding `revert-proofs/`)

| Metric | Value |
|--------|------:|
| Insertions | 3599 |
| Deletions | 187 |
| Line delta | 3786 |

Heavy host/mosaic tests (frame-alloc, frame-loop, gpu-pack-present, mosaic-coalesce, viz-frame-tick, context-restore-antialias, fb-viewport-software, rect-converters) live on **A2** `#81` only.

## Commands (A head, `web/`)

```bash
pnpm install
pnpm exec tsc --noEmit
pnpm exec tsc -p tsconfig.test.json --noEmit
pnpm build
pnpm exec vitest run
```

- `tsconfig.json`: `types: ["vite/client"]` only (no `@types/node` in `package.json`).
- `tsconfig.test.json`: `types: ["vite/client", "vitest/globals"]`.

## Production fixes (host review)

1. **Letterbox fill:** `paintClear` no longer busts the cache; `getSurfaceLetterboxFill` keys on `clearHex`. `scene-letterbox-fill-production.test.ts`: 300 `paintClear` ticks → `letterboxFillStats.rebuilds === 1`. Revert `scene-paint-clear-letterbox-reset`: `expected 300 to be 1 // Object.is equality`.
2. **GPU viewport (design b):** `WebGLRenderer.setPixelRatio(1)` always; layout DPR (cap 1.5) scales backing store via `setSize(devW, devH, false)` + CSS size. `applyDeviceRectToGlRenderer` / pack paths use per-edge `DeviceRect` only. `render-host-gpu-viewport-css.test.ts`: setup asserts `getPixelRatio() === 1`; gl.viewport/gl.scissor `[2, 87, 151, 91]` at layout pr 1.5 and window DPR 2 (capped). Reverts restore Three `devicePixelRatio`: `expected [ 3, 40, 226, 136 ] to deeply equal [ 2, 87, 151, 91 ]`.
3. **Device px materials (design b):** `RenderHost.devicePxRatio` (`DevicePxRatio`, mint `render-host-device-px-ratio.ts`; only module that reads `window.devicePixelRatio` under `src/graph/`). `host-three-pixel-materials.ts`: points `sizeAttenuation` true → no DPR multiply (GL `size` 4 @ pr 1.5); false → multiply (GL `size` 6); `LineMaterial` linewidth + resolution both device px; glow `uResolution` device px. `host-three-pixel-materials.test.ts` uses counting GL fake (uniform1f). Reverts: `expected 6 to be 4`, `expected 4 to be 6`, `expected 200 to be 300`, `expected { x: 200, y: 120 } to deeply equal { x: 300, y: 180 }`.
4. **`GlRect`:** only `toGlRectInto` brands GL rects (no `glRect()` factory; probe lines unbranded).
5. **Grain:** `letterbox-grain-stable.test.ts` uses a 2D stub; rebuild counts `randomCalls`/`stringAllocations`. Revert `letterbox-grain-stable`: `expected "random" to not be called at all, but actually been called 600 times`.
6. **Lint:** `lint-brand-casts.mjs` includes `DevicePxRatio`; bans raw `devicePixelRatio` reads anywhere under `web/src/` outside `render-host-device-px-ratio.ts` (tests exempt). Revert `device-px-ratio-read-stray`: one lint error on `src/core/fps.ts`.

## Lifecycle / device size (corrected root cause)

- `renderPrimary` uses `deviceSizeFromCssBoxInto` since `c5bb005`; be13453 lifecycle passes 9/9.
- Exact `expected 299 to be +0` on **`pack-mirror-lifecycle.test.ts:142`** (`renderTargetSetSize`) under revert **`pack-mirror-device-size-origin`** (NaN `w` / `cssBoxDim`), not letterbox grain.
- Revert **`pack-mirror-device-size-into`**: `expected 1 to be +0 // Object.is equality` at lifecycle:112 (`deviceSizeAllocated`).

## Revert rows (A)

Each `*.json` has `testFile` (under `web/`), anchored `testName` (`^…$`), and `expectedRed`. Patches: `git apply --check` at head; one vitest each; unpatched pass, patched fail.

| Row | expectedRed (patched) |
|-----|------------------------|
| `letterbox-fill-black-nudge` | `expected true to be false // Object.is equality` |
| `letterbox-fill-cache` | `expected { css: 'rgb(15, 18, 24)', …(3) } to be { css: 'rgb(15, 18, 24)', …(3) } // Object.is equality` |
| `letterbox-grain-stable` | `expected "random" to not be called at all, but actually been called 600 times` |
| `material-needs-update` | `expected 300 to be 1 // Object.is equality` |
| `mosaic-boot-primary-pack` | `expected 'plugin:pack-a' to be 'plugin:pack-c' // Object.is equality` |
| `mosaic-tile-slot-allocate` | `expected 'plugin:topology!2' to be 'plugin:topology!1' // Object.is equality` |
| `one-mirror-per-pack` | `expected 1 to be 2 // Object.is equality` |
| `pack-mirror-capture-rounding` | `expected { x: 1, y: 87, w: 152, h: 92, …(1) } to deeply equal { x: 2, y: 87, w: 151, h: 91, …(1) }` |
| `pack-mirror-device-size-into` | `expected 1 to be +0 // Object.is equality` |
| `pack-mirror-device-size-origin` | `expected 299 to be +0 // Object.is equality` |
| `pack-mirror-letterbox-16x9` | `expected undefined to deeply equal { x: +0, y: 21.875, w: 100, h: 56.25 }` |
| `pack-mirror-letterbox-viewport-y` | `expected 120 to be 20 // Object.is equality` |
| `pack-mirror-registry-tile-threshold` | `expected 61 to be 1 // Object.is equality` |
| `pack-mirror-renderer-gate-needle` | `expected [Function] to throw an error` |
| `pack-mirror-rt-viewport-dpr` | `expected false to be true // Object.is equality` |
| `present-pack-args-identity` | `expected { letterbox: false, fill: null, …(1) } to be { letterbox: false, fill: null, …(1) }` |
| `render-host-fb-viewport-h241` | `expected { x: +0, y: -1, w: 300, h: 90, …(1) } to deeply equal { x: +0, y: +0, w: 300, h: 90, …(1) }` |
| `render-host-gpu-viewport-css-revert` | `setViewport`/`setScissor` `[2, 87, 151, 91]` vs `[1, 58, 101, 61]` |
| `render-host-gpu-viewport-css-dpr2-cap-revert` | `setViewport`/`setScissor` `[2, 87, 151, 91]` vs `[1, 58, 101, 61]` (window DPR 2, renderer pr capped at 1.5) |
| `host-points-atten-true-multiply` | `expected 6 to be 4 // Object.is equality` |
| `host-points-atten-false-no-multiply` | `expected 4 to be 6 // Object.is equality` |
| `host-line-resolution-css-only` | `expected 200 to be 300 // Object.is equality` |
| `host-shader-resolution-css-only` | `expected { x: 200, y: 120 } to deeply equal { x: 300, y: 180 }` |
| `device-px-ratio-read-stray` | `src/core/fps.ts: raw \`devicePixelRatio\` read (...)` |
| `render-host-pack-mirror-no-alloc` | `expected 30 to be +0 // Object.is equality` |
| `samples-gated-on-antialias` | `expected +0 to be 4 // Object.is equality` |
| `scene-paint-clear-letterbox-reset` | `expected 300 to be 1 // Object.is equality` |
| `setSize-only-on-resize` | `expected +0 to be 1 // Object.is equality` |
| `teardown-dispose-counts` | `expected +0 to be 1 // Object.is equality` |

Dropped on A (on A2 `#81` or non-shipped): `context-restore-antialias`, `mosaic-sandbox-frame`, `mirror-frame-scope-sync`, `pack-mirror-tile-edge-shared`, `render-host-fb-viewport-software`, `render-host-frame-alloc-objects`, `pack-mirror-texture-flip-y`.

## CI note

GitHub Actions on prior head `c23241e` failed in 1–3 s with empty steps (infra). Re-check after push.
