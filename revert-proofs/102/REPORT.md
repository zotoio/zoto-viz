## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| assign-views-selective-refresh | src/graph/mosaic-assign-view-sky.test.ts :: assignViews selective sky hold > setPaneView on one tile refreshes only touched pane modes | Revert selective refreshPaneModes touch set in assignViews | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^assignViews selective sky hold > setPaneView on one tile refreshes only touched pane modes$" --reporter=json --outputFile.json=<tmp> src/graph/mosaic-assign-view-sky.test.ts | RED (expected) |
| mosaic-on-pane-pick-hook | src/graph/mosaic-viz-feed.test.ts :: mosaic onPanePick wiring > invokes live hook instead of bare setPaneView | Revert mosaic tile picker onPanePick live hook wiring | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^mosaic onPanePick wiring > invokes live hook instead of bare setPaneView$" --reporter=json --outputFile.json=<tmp> src/graph/mosaic-viz-feed.test.ts | RED (expected) |
| mosaic-pane-ids-view-change-swap | src/graph/mosaic-layout.test.ts :: close / swap / assign > mosaicPaneIdsWithViewChange lists replaced and swapped panes only | Revert swap detection in mosaicPaneIdsWithViewChange index loop | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^close / swap / assign > mosaicPaneIdsWithViewChange lists replaced and swapped panes only$" --reporter=json --outputFile.json=<tmp> src/graph/mosaic-layout.test.ts | RED (expected) |
| mosaic-pane-notice-fail-start | src/graph/mosaic-pane-notice.test.ts :: mosaic pane notice > shows and clears inline copy on a tile | Revert fail styling for Blob Mesh couldn't start sandbox copy | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^mosaic pane notice > shows and clears inline copy on a tile$" --reporter=json --outputFile.json=<tmp> src/graph/mosaic-pane-notice.test.ts | RED (expected) |
| mosaic-pane-notice-needs-review | src/graph/mosaic-pane-notice.test.ts :: mosaic pane notice > shows and clears inline copy on a tile | Revert setPaneNotice paint hook so inline needs review copy never appears | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^mosaic pane notice > shows and clears inline copy on a tile$" --reporter=json --outputFile.json=<tmp> src/graph/mosaic-pane-notice.test.ts | RED (expected) |
| mosaic-viz-feed-ubo | src/graph/mosaic-viz-feed.test.ts :: deliverMosaicDemoPacks > writes UBO to each tile's scene | Revert per-tile host pack frame delivery writing UBO buffers | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^deliverMosaicDemoPacks > writes UBO to each tile's scene$" --reporter=json --outputFile.json=<tmp> src/graph/mosaic-viz-feed.test.ts | RED (expected) |
| settings-mosaic-pick-deny-revert | src/ui/settings-mosaic-pick.test.ts :: settings mosaic pane pickers > reverts the dropdown when the live hook denies consent | Revert async consent denial reverting settings mosaic slot dropdown | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^settings mosaic pane pickers > reverts the dropdown when the live hook denies consent$" --reporter=json --outputFile.json=<tmp> src/ui/settings-mosaic-pick.test.ts | RED (expected) |
| settings-mosaic-pick-live | src/ui/settings-mosaic-pick.test.ts :: settings mosaic pane pickers > delegates slot changes to the live wall hook and reverts on failure | Revert settings mosaic slot delegating to onMosaicPanePick live hook | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^settings mosaic pane pickers > delegates slot changes to the live wall hook and reverts on failure$" --reporter=json --outputFile.json=<tmp> src/ui/settings-mosaic-pick.test.ts | RED (expected) |
| settings-mosaic-pick-persist | src/ui/settings-mosaic-pick.test.ts :: settings mosaic pane pickers > persists mosaicTiles after a slot change when no live hook is wired | Revert local mosaicTiles persistence when no live hook is wired | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^settings mosaic pane pickers > persists mosaicTiles after a slot change when no live hook is wired$" --reporter=json --outputFile.json=<tmp> src/ui/settings-mosaic-pick.test.ts | RED (expected) |
| viz-drive-clear | src/plugins/viz-drive.test.ts :: viz-drive per tile > returns to none when the pack is cleared | Revert clearVizDrive resetting tile dataset vizDrive to none | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^viz-drive per tile > returns to none when the pack is cleared$" --reporter=json --outputFile.json=<tmp> src/plugins/viz-drive.test.ts | RED (expected) |
| viz-drive-note-host-direct | src/plugins/viz-drive.test.ts :: viz-drive per tile > starts none until host-direct is noted | Revert noteHostDirect setting dataset vizDrive to host-direct | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^viz-drive per tile > starts none until host-direct is noted$" --reporter=json --outputFile.json=<tmp> src/plugins/viz-drive.test.ts | RED (expected) |

### assign-views-selective-refresh

```
AssertionError: expected 5 to be 2 // Object.is equality
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

### mosaic-on-pane-pick-hook

```
AssertionError: expected [] to deeply equal [ Array(1) ]
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### mosaic-pane-ids-view-change-swap

```
AssertionError: expected [] to deeply equal [ 'a', 'b' ]
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

### mosaic-pane-notice-fail-start

```
AssertionError: expected undefined to be 'Blob Mesh couldn\'t start, its sandbo…' // Object.is equality
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

### mosaic-pane-notice-needs-review

```
AssertionError: expected undefined to be 'needs review' // Object.is equality
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

### mosaic-viz-feed-ubo

```
AssertionError: expected false to be true // Object.is equality
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

### settings-mosaic-pick-deny-revert

```
AssertionError: expected 'plugin:talkers' to be 'plugin:topology' // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
```

### settings-mosaic-pick-live

```
AssertionError: expected [] to deeply equal [ [ 'plugin:topology', …(1) ] ]
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

### settings-mosaic-pick-persist

```
AssertionError: expected [ 'plugin:topology', 'plugin:wifi' ] to deeply equal [ 'plugin:talkers', 'plugin:wifi' ]
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

### viz-drive-clear

```
AssertionError: expected 'host-direct' to be 'none' // Object.is equality
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

### viz-drive-note-host-direct

```
AssertionError: expected 'none' to be 'host-direct' // Object.is equality
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
