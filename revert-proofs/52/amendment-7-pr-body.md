=====PR BODY=====

## Amendment 7 (QE 975bd59)

Shader-compile fallback for nixie-clock is out of scope here and goes in the separate host fallback PR.

#52 does **not** adopt host PR #88 `ContextGen` yet. When #88 lands, extend the keys below (one builder per cache) so caches reset after WebGL context restore.

### Write-on-change caches (for #88 ContextGen)

Each entry is `file:symbol` → what the skip/write gate keys on. Prefer the named key builder when adding a generation field.

| Location | Keys on |
|----------|---------|
| `web/src/plugins/nixie-wall-upload.ts:nixieLookSig` | `hour12`, `seconds`, `glow`, `flicker`, canvas `w`×`h` (pipe string) |
| `web/src/plugins/nixie-wall-upload.ts:nixieWallUploadDue` | Wall time `(h,m,s)` vs latch `lastH/lastM/lastS` (seconds-aware), plus `lookSig` from `nixieLookSig`; latch fields updated when upload runs |
| `web/src/plugins/nixie-wall-parts.ts:wallSecondKeyFromScratch` | Packed second `h*3600+m*60+s` from shared `nixieWallPartsScratch` |
| `web/src/plugins/nixie-wall-parts.ts:fillRealWallPartsScratch` | `floor(wallMs/1000)` vs `realWallLastSecKey` before rewriting scratch H/M/S |
| `web/src/plugins/nixie-wall-broadcast.ts:SharedNixieWallSecond.syncWallSecond` | `wallSecondKeyFromScratch()` vs `lastKey` (one format path per wall second for all tiles) |
| `web/src/plugins/nixie-wall-clock.ts:formatterForZone` | `timeZone ?? "local"` → `formatterCache` `Intl.DateTimeFormat` |
| `web/src/plugins/nixie-wall-clock.ts:createNixieWallClock.tick` | `floor(wallMs/1000)` vs `lastSecond` before `wallPartsFromMs`; digit H/M/S held in `cachedH/M/S` |
| `web/src/plugins/viz-pack-host.ts:syncNixiePackScope` | Per-option slot in `nixieOptSlots` vs raw `opts[NIXIE_LOOK_KEYS[i]]` (skip `parseNixieLook` when unchanged) |
| `web/src/ui/tile-hud-label.ts:createTileHudLabelLine.limitedLabel` | `(activeTiles, cadenceK)` vs `lastTileCount`/`lastCadenceK` → `cachedLabel` from `tileLimitedSharingLabel` (ordinal via `vizCadenceOrdinal` inside copy, not cached separately) |
| `web/src/ui/tile-hud-label.ts:createTileHudLabelLine.writeText` | `text` vs `el.textContent` (skip DOM write) |
| `web/src/ui/viz-hud.ts:VizHud.tick` (wall skip strip) | LIMITED/skip string from `skipLabelLine.limitedLabel(activeTiles, chrome.cadenceK)` then `skipLabelLine.writeText(skipEl, …)`; tooltip title vs `lastSkipTitle` |
| `web/src/ui/viz-hud.ts:VizHud.tick` (metric row) | `metric.label` / `metric.value` vs `lastMetricLabel` / `lastMetricValue` |
| `web/src/ui/viz-hud.ts:VizHud.tick` (mosaic tile share lines) | Per-`tileId` formatted skip-rate string vs `lastMosaicLineText` before `row.label.writeText` |
| `web/src/ui/viz-hud.ts:VizHud.setDevWallBadInput` | Bad-input message string vs `lastDevBadInput` before updating `devBadInputEl` |
| `web/src/core/viz-dev-wall-flags.ts:parseWallClockFlag` | Trimmed `?vizWallClock=` raw string vs `lastParsedWallClockRaw` (skip re-`setDevWallFlagClock` when unchanged) |

**Removed in #52 (no key to extend):** per-frame `optsFor` / `cachedModeOpts` cache (`main-present-opts-localstorage` path; steady present reads `buildPresentOptsFor` each frame).

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
