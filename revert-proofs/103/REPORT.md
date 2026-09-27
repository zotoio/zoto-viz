## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| switch-pane-tile-succeeds | src/app/switch-pane-view.test.ts :: switchPaneView > entry tile > succeeds through teardown, swap, and mount | Revert switchPaneView mount after tile pick | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^switchPaneView > entry tile > succeeds through teardown, swap, and mount$" --reporter=json --outputFile.json=<tmp> src/app/switch-pane-view.test.ts | RED (expected) |

### switch-pane-tile-succeeds

```
AssertionError: expected "vi.fn()" to be called with arguments: [ 'plugin:talkers' ]

Number of calls: 0

    at Proxy.<anonymous> (file://<tmp>
    at Proxy.<anonymous> (file://<tmp>
    at Proxy.methodWrapper (file://<tmp>
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```
