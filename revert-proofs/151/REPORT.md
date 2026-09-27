## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| hud-governor-enabled | src/app/__tests__/render-scale-governor-production.test.ts :: render-scale governor production wiring > HUD shows gov on with flag on and gov off with flag off | Revert HUD governorEnabled pass-through to vizBudgetOverlayFromStats | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^render-scale governor production wiring > HUD shows gov on with flag on and gov off with flag off$" --reporter=json --outputFile.json=<tmp> -- ../src/app/__tests__/render-scale-governor-production.test.ts | RED (expected) |
| flag-read | | | | **ERROR: row flag-read: baseline test must PASS --- baseline output --- (node:42334) ExperimentalWarning: Type Stripping is an experimental feature and might change at any time (Use `node --trace-warnings ...` to show where the warning was created) DOMException [AbortError]: The operation was aborted.     at Fetch.onAsyncTaskManagerAbort (file://<tmp>     at Object.<anonymous> (file://<tmp>     at AsyncTaskManager.abortAll (file://<tmp>     at AsyncTaskManager.abort (file://<tmp>     at DetachedBrowserFrame.abort (file://<tmp>     at DetachedWindowAPI.abort (file://<tmp>     at teardownWindow (file://<tmp>     at Object.teardown (file://<tmp>     at file://<tmp>     at Traces.$ (file://<tmp>** |
| present-tick | | | | **ERROR: row present-tick: baseline test must PASS --- baseline output --- (node:54679) ExperimentalWarning: Type Stripping is an experimental feature and might change at any time (Use `node --trace-warnings ...` to show where the warning was created) DOMException [AbortError]: The operation was aborted.     at Fetch.onAsyncTaskManagerAbort (file://<tmp>     at Object.<anonymous> (file://<tmp>     at AsyncTaskManager.abortAll (file://<tmp>     at AsyncTaskManager.abort (file://<tmp>     at DetachedBrowserFrame.abort (file://<tmp>     at DetachedWindowAPI.abort (file://<tmp>     at teardownWindow (file://<tmp>     at Object.teardown (file://<tmp>     at file://<tmp>     at Traces.$ (file://<tmp>** |

### hud-governor-enabled

```
AssertionError: expected 'gov off · GPU 12.0 ms · p95 12.0 · sc…' to be 'gov on · GPU 12.0 ms · p95 12.0 · sca…' // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithTimeout (file://<tmp>
```
