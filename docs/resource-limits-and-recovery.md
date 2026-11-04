# Resource limits and crash recovery

Why this exists: a wall left running for 22 h had 629 leaked AudioContexts (one per spoken
TTS line whose `resume()`/stream read never settled). Each one owns a real-time audio thread,
so the renderer used ~11 cores and 14.8 GB RSS and every panel animated slowly.

## Page side (web)

| Piece | File | What it does |
|---|---|---|
| Audio manager | `web/src/audio/audio-manager.ts` | Every AudioContext is created/closed here and counted (`liveAudioContexts()`). TTS shares one lazy context, suspended after 4 s idle; `resume()` times out at 3 s; a stalled TTS read is abandoned after 10 s. |
| Frame guard | `web/src/graph/frame-guard.ts`, `render-host.ts` | Each view's `hostFrame` runs in a try/catch; after `viewErrorBudget` consecutive throwing frames the view is disabled and reported (other views keep drawing; a context restore re-enables). Optional `fpsCap`. Idle skip for views that implement `needsFrame()`. |
| Context-loss limit | `render-host.ts` | `contextLossLimit` browser-initiated losses within `contextLossWindowMs` drop the backing store to `fallbackPixelRatio` and keep it capped. |
| State stream | `web/src/app/ws-stream.ts` | `/ws?proto=delta`, exponential backoff with jitter, 5 s stale-socket check, pause while hidden + resync on return, resync on sequence gaps. |
| Page health | `web/src/app/page-health.ts` | Global `error`/`unhandledrejection` reporting (deduped) to `/api/page/error`; heartbeat to `/api/page/heartbeat`; soft self-reload after `softReloadAfterH` hours once input has been quiet for `softReloadQuietMs` and nothing is speaking. Reloads are rate-limited to one per 10 min. |
| Visible polls | `web/src/core/visible-poll.ts` | Feed, debug log and inspect panes skip polling while the tab is hidden and catch up once on return. |

Override any page tunable (defaults in `web/src/app/recovery-config.ts`):

```js
localStorage["zoto-viz.recovery"] = JSON.stringify({ fpsCap: 30, softReloadAfterH: 24, stream: { staleMs: 8000 } });
```

## Backend (service)

* `service/state_delta.py`: structural patches for `/ws`. Delta clients get one full frame then
  `{"type":"delta","seq","base","patch"}`; legacy clients still get full frames. Clients may send
  `{"type":"pause"}`, `{"type":"resume"}` or `{"type":"resync"}`.
* `service/page_health.py`: heartbeat + error endpoints, `GET /api/page/health`, and a sweep that
  logs pages whose heartbeat went stale (hung/crashed tab) to `/api/logs`.

Watchdog thresholds (env on the monitor):

| Env | Default | Meaning |
|---|---|---|
| `ZOTO_VIZ_WD_MAX_AUDIO_CTX` | 8 | live AudioContexts above this are unhealthy |
| `ZOTO_VIZ_WD_MAX_HEAP_MB` | 1536 | JS heap above this is unhealthy |
| `ZOTO_VIZ_WD_MIN_FPS` | 5 | visible fps below this ... |
| `ZOTO_VIZ_WD_LOW_FPS_SEC` | 60 | ... for this long is unhealthy |
| `ZOTO_VIZ_WD_STALE_SEC` | 30 | no heartbeat for this long is logged as a hung/crashed tab |
| `ZOTO_VIZ_WD_ACTION` | `flag` | `flag` logs only; `reload` also tells the page to reload itself |

A hung or crashed renderer cannot reload itself; the stale sweep only flags it. Restarting
the browser tab from outside (e.g. a kiosk launcher with `--remote-debugging-port`) is out of scope.
