# PR #42 split A — revert proof report

- **Base:** `6520b014472c05f831ac5204429be2affb8473cb` (`main`)
- **Stack A head:** `0add9cb` (`cursor/wall-duplicate-pack-tiles-d355`)
- **Stack A2 head:** `34a2cf3` (`cursor/pack-mirror-readback-harness-d355`, draft on A)

## Size (vs `origin/main`, excluding `revert-proofs/`)

| PR | Approx. insertions |
|----|-------------------|
| 42-A (production + unit tests) | ~3448 |
| 42-A2 (readback harness delta on A) | ~1111 |

## Letterbox 16:9 on 1:1 mirror (UX Pro)

| Stack | Test | Revert row |
|-------|------|------------|
| A unit | `pack-mirror-letterbox-16x9.test.ts` @ pr **1** and **1.5** — inner `setViewport`, `zotoSurfacePanelClearHex()` bar `setClearColor`, first scene row device Y | `pack-mirror-letterbox-16x9` (stretch fill) |
| A2 harness | `pack-mirror-readback.test.ts` letterbox SwiftShader @ pr **1** / **1.5** — bar centre rgba vs panel token; `expect` only | `pack-mirror-letterbox-16x9-readback` (same stretch patch) |

**Unpatched (A, pr 1):** `Tests 1 passed`

**Patched (A, pr 1):** `AssertionError: expected undefined to deeply equal { x: 0, y: 21.875, w: 100, h: 56.25 }` (stretch uses full-tile viewport; centred inner vp missing)

## Build / typecheck

- `pnpm build` (main `tsc` + `tsconfig.test.json` + vite): **pass** on A head
- `tsc` projects: **0 errors** on A head

## Test suites (A head, node 22)

| Suite | Result |
|-------|--------|
| vitest run #1 | 705 passed, 3 skipped (708 tests) (+2 letterbox 16:9 unit) |
| vitest run #2 | (re-run at release gate) |
| pytest | 432 passed, 1 failed (`test_node_harness_session_and_tools` — known env) |

Readback on **A2**: 12 matrix + 3 zoom + **2** letterbox16x9 rows (`pack-mirror-readback.test.ts`).

## Lifecycle `deviceSizeAllocated` (A, vs #73 on 4527885)

| Check | Evidence |
|-------|----------|
| Root cause | **Not** letterbox grain — per-frame `deviceSizeFromCssBox()` in `renderPrimary` (allocating `{pw,ph}` each frame). Frame-alloc row sees **~300** `deviceSizeAllocated`; lifecycle guards **0** in the 300-frame loop (line ~102). |
| Fix | `deviceSizeFromCssBoxInto(box, pr, devicePackSizeScratch)` + stable `lastRenderDeviceSize`; lifecycle uses cached `getSurfaceLetterboxFill` (not `surfaceLetterboxFill` per frame). |
| Revert row | `pack-mirror-device-size-into` → `deviceSizeAllocated` ≫ 0 over 300 frames |

## Typecheck (QE)

- `pnpm exec tsc --noEmit` and `tsc -p tsconfig.test.json --noEmit`: **0 errors**; browser `tsconfig.json` keeps `types: ["vite/client"]` only; test project uses `vitest/globals` (no `@types/node` in either config).

## Items 7–8: origin-branded rects (Platform Architect A)

| Check | Evidence |
|-------|----------|
| `DeviceRect` top-left; `GlRect` bottom-left only via `toGlRectInto` | `pack-mirror-rect.ts`, `render-host.writeFbViewport`, `pane-change` (`ProbeRect = GlRect`, `CanvasChangeProbe` → `DeviceRect`) |
| `CanvasDeviceHeight` from `RenderHost` (`canvas.height` on resize) | `render-host.ts` `refreshCanvasDeviceHeight` |
| `@ts-expect-error` boundary guards | `pack-mirror-rect.boundary.ts` (double flip, GlRect on probe, plain number canvas height) |
| H=241 bottom row `GlRect` | `render-host-fb-viewport.test.ts` → `{ x: 0, y: 0, w: 300, h: 90, __unit: "gl" }` |
| Revert row | `render-host-fb-viewport-h241` → `y: -1` (drop canvas-height clamp on host viewBox) |

## Letterbox fill / software bars (Performance Pedant B)

| Check | Evidence |
|-------|----------|
| Fill once per `clearHex` (`css` + `hex` + baked `pattern`) | `getSurfaceLetterboxFill` / `scene.ts` `surfaceLetterboxFill()`; GPU uses `fill.hex` in `paintLetterboxBarsThree` |
| 300 frames same instance, 0 `match`, 1 rebuild on theme change | `letterbox-fill-cache.test.ts` |
| Software bars: scratch tuple, 0 `Math.random` / hot-path strings | `paintLetterboxBarsInto` + `letterbox-grain-stable.test.ts` |
| Probe stability (2 identical frames → 0 changes) | `letterbox-grain-stable.test.ts` samples top bar centre in **device** space; grain uses fixed-seed tile — probe rect avoids jitter pixels |
| Revert rows | `letterbox-fill-cache` (rebuild every call); `letterbox-grain-stable` (per-frame `Math.random` jitter → probe fires ~299/300) |

## Revert rows (A)

Each patch: `git apply --check` clean (no fuzz) at A head; anchored vitest goes **red**.

| Row | Assertion (patched run) |
|-----|-------------------------|
| `letterbox-fill-cache` | `letterboxFillStats.rebuilds` ≫ 1 over 300 frames |
| `letterbox-grain-stable` | `Math.random` called; probe change on 2nd identical frame |
| `pack-mirror-letterbox-16x9` | `expected undefined to deeply equal { x: 0, y: 21.875, w: 100, h: 56.25 }` (stretch revert) |
| `pack-mirror-capture-rounding` | `AssertionError: expected { x: 1, y: 87, w: 152, h: 92 } to deeply equal { x: 2, y: 87, w: 151, h: 92 }` (floor/ceil on `deviceRectBottomLeftCssInto`) |
| `pack-mirror-tile-edge-shared` | `expected 152 to be 151` (`aOut.x + aOut.w` vs `bOut.x`) |
| `pack-mirror-device-size-into` | lifecycle / Into row fails on `renderTargetSetSize` or size identity |
| `pack-mirror-device-size-origin` | `expected N to be +0` on `renderTargetSetSize` (NaN `w` without `cssBoxDim` / finite guard) |
| `mosaic-boot-primary-pack` | primary pack id mismatch on 4-pack boot |
| `mosaic-sandbox-frame` | `expected "spy" to be called 10 times` → **0** (`sandbox.frame` skipped when mosaic demo coalesce) |
| `render-host-fb-viewport-software` | `expected 270 to be +0` (`lastVp.y` on software tile0 — GL flip regression) |
| `render-host-fb-viewport-h241` | bottom row `GlRect` `y: -1` instead of `{ x: 0, y: 0, w: 300, h: 90, __unit: "gl" }` |
| `render-host-frame-alloc-objects` | `expected N to be +0` on `converterEdgeObjectsAllocated` |
| `mirror-frame-scope-sync` | extra `scopeSyncRuns` / fingerprint path |
| `present-pack-args-identity` | `presentPack` opts / viewport identity break |
| `material-needs-update` | material update / draw regression |
| `pack-mirror-rt-viewport-dpr` | RT viewport uses device `pw/ph` instead of CSS `cssSize` |
| `pack-mirror-texture-flip-y` | `flipY` revert |
| `one-mirror-per-pack` | registry allocation |
| `setSize-only-on-resize` | per-frame `setSize` |
| `teardown-dispose-counts` | dispose counts |
| `context-restore-antialias` | antialias restore |
| `samples-gated-on-antialias` | MSAA gate |

## Revert rows (A2 only)

| Row | Assertion (patched run) |
|-----|-------------------------|
| `pack-mirror-device-pixel-ratio` | `expect(state.ok.quadrantTlOk).toBe(true)` → **false** at 200% zoom (`rendererDpr` follows `windowDpr` instead of capped renderer DPR) |
| `pack-mirror-letterbox-16x9-readback` | `expect(rgbaNear(topBarRgba, expectedBarRgba)).toBe(true)` → **false** after stretch (bar samples scene green) |

## Converter sanity (unchanged)

- 100k random tile pairs × pr ∈ {1, 1.25, 1.5, 1.75, 2}: **0** gaps/overlaps on shared edges (`toDeviceRectInto` / top-left GL readback path).
