# PR #88 blocker status vs fbd7ed1 verdict

**Report head (pushed):** `771e2eca` — notice commits reverted; no `web/src/core/wall-notice-region.ts`.  
**Notice work (local only):** branch `cursor/wall-notice-integration-d529` @ `9adfd1ab`.

**Diff vs `origin/main`, excluding `revert-proofs/`:** 32 files, +2283 / −22 lines (~2725 diff lines). **Under ~2800 — no #88a/#88b split.**

**Vitest (`web/`, full run):**

| | Passed | Skipped | Total |
|---|---:|---:|---:|
| `main` (`6520b01`) | 663 | 3 | 666 |
| #88 @ `771e2eca` | 704 | 3 | 707 |

(+41 tests on branch.)

---

## Blocker status (16)

| # | Topic | Status | Resolving commit(s) | Notes |
|---|--------|--------|---------------------|--------|
| 1 | Rows under `revert-proofs/88/` | **Resolved** | `aee36fd1`, `8fc77adc` | Patches/json live under `revert-proofs/88/`. |
| 2 | Wrong sidecar reds; link-failure isolation | **Partial** | `4d6ebd20`, `ab5fbcd1`, `b9ae0be5` | Tests use 599-loop / measured reds for Three.js compile path. **`compile-once.patch` and `link-failure.patch` still target deleted `tile-shader-build.ts` — `git apply` fails.** `nixie-text.json` points at old test path (`nixie-shader-fallback.test.ts`); live test is `src/plugins/nixie-fallback.test.ts`. |
| 3 | Real-GPU sky regression (`tile-shader-build`) | **Resolved** | `b9ae0be5`, `8fc77adc` | `tile-shader-build.ts` removed; `compilePluginSky` + `backdrop.setPluginShader(..., gpuProbe)` use Three.js `renderer.compile` / `ensurePluginMat`. |
| 4 | `main.ts` clears fallback after mount | **Resolved** | `8fc77adc` | Error path returns after `setPluginShader` without `setPluginShader(null)` (`main.ts` ~735–740). `mountShaderFallback` idempotent per `packKey` (`render-host.ts` ~348). Rows: `scene-mounts-fallback`, `fallback-survives-sky-reset`. |
| 5 | Sweep survivors / hunk map | **Partial** | `8fc77adc`, `5acbc56a` | Named rows: `scene-mounts-fallback`, `fallback-survives-sky-reset`, `drive-writes-tile`, `mosaic-tile-keyed`, push rows, context-gen rows. **Full remove-one-hunk sweep not re-published; many revert patches still reference removed files.** |
| 6 | Visibility row vacuous | **Resolved** | `8fc77adc` | `shader-fallback-host.test.ts` injects `style.css`, asserts `getComputedStyle` + `offsetParent`. |
| 7 | Chip `text-transform: uppercase` | **Resolved** | `8fc77adc` | `.tile-shader-fallback-chip` uses `text-transform: none`; `simple-view-chip` asserts it. |
| 8 | Test-only exports (`wall-notice.ts`, etc.) | **Partial** | `8fc77adc`, `b9ae0be5` | `graph/wall-notice.ts` gone; tests use DOM class strings. **`tileShaderDead` still exported with no production callers.** |
| 9 | `fallbackText` contract vs `viz-pack-fallback` | **Resolved (room design)** | `b9ae0be5`, `208a76bf` | Push model: `setFallbackText` in `viz-contract.ts` / `viz-sdk.ts` / host message; `viz-pack-fallback.ts` removed; packs push on change (`shader-fallback-push.test.ts`). Not frame-polling `fallbackText(frame)`. |
| 10 | Nixie fallback wrong in production | **Resolved** | `8fc77adc`, pack push | `formatNixieFallbackLine` + cache key tests in `nixie-fallback.test.ts`; live text from pack `setFallbackText`. |
| 11 | `packetTunnelFallbackText` per-frame alloc | **Resolved** | `b9ae0be5`, push tests | Tunnel pushes on change; `tunnel-write-on-change` row in `shader-fallback-push.test.ts`. |
| 12 | `driveShaderFallback` allocates every frame | **Resolved** | `8fc77adc` | `liveFallbacks` + `driveShaderFallbacks`; `main.ts` ~1026 single call. |
| 13 | Info log “once” not proven | **Partial** | `b9ae0be5` | `link-failure` asserts `log` once with `"link error"`. `compile-once` expects `log` **0** on success (no failure-path log row). `logged` field gone with `tile-shader-build`. |
| 14 | `pack-name-sanitise` strip rules | **Resolved** | `8fc77adc` | Explicit `\u0000`, `<b>`, `|?*` cases in `shader-fallback-host.test.ts`. |
| 15 | `nixie-write-on-change` DOM pins | **Resolved** | `8fc77adc` | `nixie-write-on-change-dom`: `dispose`, `isConnected`, `querySelector` on `node` / `node2`. |
| 16 | PR body / verification accuracy | **Open** | — | Stale revert patches (blocker 2), test count **707** (704 pass), hunk map incomplete until patches regenerated for Three.js latch path. |

---

## Wall notices (out of scope on pushed #88)

Per product direction: **no second `wall-notice-region.ts` on #88** until region PR merges to `main`. Integration preserved locally on `cursor/wall-notice-integration-d529` @ `9adfd1ab` for re-application after `merge main` + `postWallNotice({ key, … })` (no `wall` argument).
