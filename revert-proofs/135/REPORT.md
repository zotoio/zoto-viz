## Revert proof

| row | test | revert description | result |
| --- | --- | --- | --- |
| ingest-sky-pin-plugin | mosaic-ingest-sky-plan.test.ts | Revert ingestSkyPlan pinPluginTileSkies wiring | RED (expected) |
| pin-undefined-sky-guard | mosaic.test.ts | Revert pinPluginTileSkies undefined guard | RED (expected) |
| focus-main-tile-slot | apply-mode-mosaic.test.ts | Revert mosaicFocusSlot main-tile fallback | RED (expected) |

### ingest-sky-pin-plugin

```
AssertionError: expected undefined to be 'space' // Object.is equality
```

### pin-undefined-sky-guard

```
AssertionError: expected { 'plugin:backrooms': 'plugin', …(2) } to strictly equal { 'plugin:backrooms': 'plugin', …(1) }
```

### focus-main-tile-slot

```
AssertionError: expected 'plugin:talkers' to be 'plugin:wifi' // Object.is equality
```
