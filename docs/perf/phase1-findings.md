# Phase 1 findings — pack frame path

Branch: `cursor/pack-frame-path-2874` (local name may use `-2874` suffix per cloud agent policy).

## Root cause — frozen Voxel World camera

The monitor WebSocket broadcast loop (`service/monitor.py` `broadcast_loop`) still delivers full `state` JSON at **1 Hz**. The host built one viz `VizDataFrame` per state message and called the sandbox `onFrame` at that rate. Voxel World's sim step used `frame.dt` (~1 s) clamped to **0.1 s** per tick (`plugins/src/voxel-world/frontend/engine.ts`), so camera motion advanced 0.1 s of sim time per real second while the plugin sky shader kept animating from `uTime` at display refresh.

**Fix:** opt-in `viz.presentTick` (already in the contract on #128) is now enabled for Voxel World. The pack keeps receiving 1 Hz data frames but runs simulation and viz writes on **`onPresent`** with `tick.frameMs / 1000` as dt. Sandbox viz writes are **batched** into one `writeBatch` postMessage per frame/present handler turn.

## Instrumentation

Enable with `?packPerf=1` or `localStorage.setItem('zoto-viz.packPerf', '1')`.
The flag is read once at page load and cached (#196): changing `?packPerf` needs a reload; localStorage changes are live (other tabs via the `storage` event, same tab via `refreshPackPerfEnabled()`). Either source enables it (OR), so with `?packPerf` in the URL, clearing localStorage keeps it on until a reload.

| Signal | Meaning |
|--------|---------|
| `frameMs.p50` / `p99` | Present-to-present intervals (rAF), ms |
| `hitches.over25` / `over50` | Frames longer than 25 ms / 50 ms |
| `gpuMs.*` | `EXT_disjoint_timer_query_webgl2` per main-stage draw when available |
| `packs.<id>.onPresentPerSec` | Present ticks delivered to sandbox |
| `packs.<id>.sandboxFramePerSec` | 1 Hz viz data frames |
| `writes.*PerFrame` | Sandbox viz write batches / bytes (when batching) |

**Read on Andrew's machine (loopback):**

- HTTP: `GET http://127.0.0.1:7020/api/pack-perf` (browser POSTs snapshot every ~2 s while enabled)
- MCP: `tools/call` → `get_pack_perf` on `POST /mcp`
- Debug panel (B): monitor log unchanged; perf JSON is via HTTP/MCP above

Overhead when disabled: a single cached `packPerfEnabled()` boolean check on hot paths, with 0 storage reads and 0 URL parses per frame (counted in `web/src/core/pack-host-perf.test.ts`; wall-clock timing belongs to the local GPU runner, reported, never asserted).

## Sandbox safety

- Pack iframe remains `sandbox="allow-scripts"` with unchanged CSP (`connect-src 'none'`).
- Viz batch caps: **32 messages** and **4096 bytes** per batch (`viz-write-batch.ts`); same slot/uniform caps as before.
- Consent hashing unchanged for code/shader; only presentation of missing consent for skies was fixed (visible notice + `console.warn`).

## Tests at push SHA

Run on the branch after push:

```bash
cd web && pnpm vitest run
cd .. && pytest
cd web && pnpm exec tsc --noEmit
```

Record exact pass/fail counts in the agent summary; failures present on `cursor/catchup-consolidation` before this work should be listed separately from regressions introduced here.
