# PR #42 split A — revert proof report

- **Base:** `6520b014472c05f831ac5204429be2affb8473cb` (`main`)
- **Stack A:** `cursor/wall-duplicate-pack-tiles-d355` (see git head on branch)
- **Stack A1.5:** `#TBD` `cursor/host-pixel-lifecycle-revert-rows-d355-e7d4` (host pixel material counting-GL rows, pack-mirror lifecycle + letterbox presenter rows, device-px-ratio lint row)
- **Stack A2:** `#81` `cursor/pack-mirror-readback-harness-d355` (frame-alloc / frame-loop / gpu-pack-present / mosaic-coalesce unit tests)

## Size (vs `origin/main`, excluding `revert-proofs/`)

| Metric | Value |
|--------|------:|
| Insertions | 2946 |
| Deletions | 187 |
| Line delta | 3133 |

Heavy host/mosaic tests (frame-alloc, frame-loop, gpu-pack-present, mosaic-coalesce, viz-frame-tick, context-restore-antialias, fb-viewport-software, rect-converters) live on **A2** `#81` only.

Host pixel material counting-GL tests, pack-mirror lifecycle harness, and pack-mirror letterbox presenter rows live on **A1.5** (stacked on A).

## Commands (A head, `web/`)

```bash
pnpm install
pnpm exec tsc --noEmit
pnpm exec tsc -p tsconfig.test.json --noEmit
pnpm build
pnpm exec vitest run
pnpm lint
```

- `tsconfig.json`: `types: ["vite/client"]` only (no `@types/node` in `package.json`).
- `tsconfig.test.json`: `types: ["vite/client", "vitest/globals"]`.

## Production fixes (host review)

1. **Letterbox fill:** `paintClear` no longer busts the cache; `getSurfaceLetterboxFill` keys on `clearHex`. `scene-letterbox-fill-production.test.ts`: 300 `paintClear` ticks → `letterboxFillStats.rebuilds === 1`. Revert `scene-paint-clear-letterbox-reset`: `expected 300 to be 1 // Object.is equality`.
2. **GPU viewport (design b):** `WebGLRenderer.setPixelRatio(1)` always; layout DPR (cap 1.5) scales backing store via `setSize(devW, devH, false)` + CSS size. `applyDeviceRectToGlRenderer` / pack paths use per-edge `DeviceRect` only. `render-host-gpu-viewport-css.test.ts`: setup asserts `getPixelRatio() === 1`; gl.viewport/gl.scissor `[2, 87, 151, 91]` at layout pr 1.5 and window DPR 2 (capped). Reverts restore Three `devicePixelRatio`: `expected [ 3, 40, 226, 136 ] to deeply equal [ 2, 87, 151, 91 ]`.
3. **Device px materials (design b):** `RenderHost.devicePxRatio` (`DevicePxRatio`, mint `render-host-device-px-ratio.ts`; only module that reads `window.devicePixelRatio` under `src/graph/`). `host-three-pixel-materials.ts`: points `sizeAttenuation` true → no DPR multiply (GL `size` 4 @ pr 1.5); false → multiply (GL `size` 6); `LineMaterial` linewidth + resolution both device px; glow `uResolution` device px. Revert rows for these behaviours ship on **A1.5** (`host-three-pixel-materials.test.ts`).
4. **`GlRect`:** only `toGlRectInto` brands GL rects (no `glRect()` factory; probe lines unbranded).
5. **Grain:** `letterbox-grain-stable.test.ts` uses a 2D stub; rebuild counts `randomCalls`/`stringAllocations`. Revert `letterbox-grain-stable`: `expected "random" to not be called at all, but actually been called 600 times`.
6. **Lint:** `lint-brand-casts.mjs` includes `DevicePxRatio`; bans raw `devicePixelRatio` reads anywhere under `web/src/` outside `render-host-device-px-ratio.ts` (tests exempt). Stray-read revert row on **A1.5**.

Pack-mirror lifecycle / letterbox presenter revert rows ship on **A1.5** (`pack-mirror-lifecycle.test.ts`, `pack-mirror-letterbox*.test.ts`).

## Revert rows (A)

Each `*.json` has `testFile` (under `web/`), anchored `testName` (`^…$`), and `expectedRed`. Patches: `git apply --check` at head; one vitest each; unpatched pass, patched fail.

| Row | expectedRed (patched) |
|-----|------------------------|
| `letterbox-fill-black-nudge` | `expected true to be false // Object.is equality` |
| `letterbox-fill-cache` | `expected { css: 'rgb(15, 18, 24)', …(3) } to be { css: 'rgb(15, 18, 24)', …(3) } // Object.is equality` |
| `letterbox-grain-stable` | `expected "random" to not be called at all, but actually been called 600 times` |
| `mosaic-boot-primary-pack` | `expected 'plugin:pack-a' to be 'plugin:pack-c' // Object.is equality` |
| `mosaic-tile-slot-allocate` | `expected 'plugin:topology!2' to be 'plugin:topology!1' // Object.is equality` |
| `pack-mirror-capture-rounding` | `expected { x: 1, y: 87, w: 152, h: 92, …(1) } to deeply equal { x: 2, y: 87, w: 151, h: 91, …(1) }` |
| `pack-mirror-registry-tile-threshold` | `expected 61 to be 1 // Object.is equality` |
| `pack-mirror-renderer-gate-needle` | `expected [Function] to throw an error` |
| `pack-mirror-rt-viewport-dpr` | `expected false to be true // Object.is equality` |
| `render-host-gpu-viewport-css-revert` | `expected [ 3, 40, 226, 136 ] to deeply equal [ 2, 87, 151, 91 ]` |
| `render-host-gpu-viewport-css-dpr2-cap-revert` | `expected [ 3, 40, 226, 136 ] to deeply equal [ 2, 87, 151, 91 ]` (window DPR 2, layout pr capped at 1.5) |
| `scene-paint-clear-letterbox-reset` | `expected 300 to be 1 // Object.is equality` |

Rows on **A1.5** only: `host-points-atten-*`, `host-line-resolution-css-only`, `host-shader-resolution-css-only`, `device-px-ratio-read-stray`, `pack-mirror-device-size-*`, `setSize-only-on-resize`, `teardown-dispose-counts`, `samples-gated-on-antialias`, `one-mirror-per-pack`, `material-needs-update`, `pack-mirror-letterbox-16x9`, `pack-mirror-letterbox-viewport-y`, `render-host-pack-mirror-no-alloc`, `present-pack-args-identity`.

Dropped on A (on A2 `#81` or non-shipped): `context-restore-antialias`, `mosaic-sandbox-frame`, `mirror-frame-scope-sync`, `pack-mirror-tile-edge-shared`, `render-host-fb-viewport-software`, `render-host-frame-alloc-objects`, `pack-mirror-texture-flip-y`.

## CI note

Re-check Actions after push.
