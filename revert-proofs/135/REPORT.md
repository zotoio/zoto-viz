## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| focus-main-tile-slot | src/app/apply-mode-mosaic.test.ts :: mosaicFocusSlot > prefers the main tile over the first slot when focus is stale | Revert mosaicFocusSlot main-tile fallback | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^mosaicFocusSlot > prefers the main tile over the first slot when focus is stale$" --reporter=json --outputFile.json=<tmp> -- ../src/app/apply-mode-mosaic.test.ts | RED (expected) |
| ingest-sky-pin-plugin | src/graph/mosaic-ingest-sky-plan.test.ts :: Mosaic.ingestSkyPlan via applyLooks > keeps unlisted tile skies on a partial unique-sky plan and never stores undefined | Revert ingestSkyPlan existing tileSkies argument to pinPluginTileSkies | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^Mosaic\\.ingestSkyPlan via applyLooks > keeps unlisted tile skies on a partial unique-sky plan and never stores undefined$" --reporter=json --outputFile.json=<tmp> -- ../src/graph/mosaic-ingest-sky-plan.test.ts | RED (expected) |
| pin-undefined-sky-guard | src/graph/mosaic.test.ts :: mosaic unique skies > drops undefined mosaic sky entries and still pins plugin looks | Revert pinPluginTileSkies undefined guard | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^mosaic unique skies > drops undefined mosaic sky entries and still pins plugin looks$" --reporter=json --outputFile.json=<tmp> -- ../src/graph/mosaic.test.ts | RED (expected) |

### focus-main-tile-slot

```
AssertionError: expected 'plugin:talkers' to be 'plugin:wifi' // Object.is equality
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

### ingest-sky-pin-plugin

```
AssertionError: expected undefined to be 'space' // Object.is equality
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

### pin-undefined-sky-guard

```
AssertionError: expected { 'plugin:backrooms': 'plugin', …(2) } to strictly equal { 'plugin:backrooms': 'plugin', …(1) }
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
