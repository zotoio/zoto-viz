=====PR BODY=====

## Amendment 7 (QE 975bd59)

Shader-compile fallback for nixie-clock is out of scope here and goes in the separate host fallback PR.

### console errors at head

- **`'fc' : undeclared identifier` / GLSL field-selection:** `plugins/src/nixie-clock/sky/fragment.glsl` (shimmer line used `fc.x`). Same bug on `origin/main`; fixed on this branch (`gl_FragCoord.x`). Row: `nixie-clock-sky.test.ts` A7 compile probe → 0 errors; revert `nixie-fc-glsl-revert` → red (1 error).

### CSP inline-script violations

- Host shell `web/index.html` meta CSP unchanged vs `origin/main` (`script-src 'self' 'wasm-unsafe-eval'` — no `'unsafe-inline'` on the app shell).
- Plugin sandbox iframe in `web/src/plugins/host.ts` still sets `script-src 'unsafe-inline' blob:` (unchanged vs main except unrelated `syncVizTileScope` on unload in #52). Any console CSP inline-script noise from plugin iframes predates #52; not introduced by this PR.

### Rows (Amendment 7)

| Row | Pass | Revert |
|-----|------|--------|
| A7 nixie GLSL compile | GREEN — `probePluginSkyCompile(wrapPluginSky(nixie frag))` null | RED — `nixie-fc-glsl-revert` (undeclared `fc`) |
| A7 A5 per-tile delivered @2×2 3000 | GREEN — each of 4 tiles `delivered=200` / 600 frames (reported in `perTileDelivered`) | RED — `shot-3-per-tile-mirror-revert` (≥1 tile `delivered=0`) |
| A3 Shot 1 boot refusal | GREEN — new tab + reload + blocked `GET /api/profiles`; stored `anim.mosaicTiles` bytes identical before/after | RED — `mosaic-h6-boot-persist-revert` |

=====PR BODY=====
