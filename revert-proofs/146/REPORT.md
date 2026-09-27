## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| row-01-boot-port-pickup | src/plugins/sandbox-write-path.counts.test.ts :: sandbox write path counts (#129) > 1 boot ready and timeout counts > reaches ready with 0 timeouts; 15s fake time still 0 timeouts | Revert boot-channel port adoption in sandbox-frame (row-01-boot-port-pickup) | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^sandbox write path counts \\(#129\\) > 1 boot ready and timeout counts > reaches ready with 0 timeouts; 15s fake time still 0 timeouts$" --testTimeout=60000 --reporter=json --outputFile.json=<tmp> -- ../src/plugins/sandbox-write-path.counts.test.ts | RED (expected) |
| row-02-boot-channel-parent-source | src/plugins/sandbox-write-path.counts.test.ts :: sandbox write path counts (#129) > 2 boot-channel source === parent > ignores boot-channel when event.source is not parent (0 ports adopted) | Revert boot-channel event.source === parent guard (row-02-boot-channel-parent-source) | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^sandbox write path counts \\(#129\\) > 2 boot-channel source === parent > ignores boot-channel when event\\.source is not parent \\(0 ports adopted\\)$" --testTimeout=120000 --reporter=json --outputFile.json=<tmp> -- ../src/plugins/sandbox-write-path.counts.test.ts | RED (expected) |
| row-03-port-not-window-postmessage | src/plugins/sandbox-write-path.counts.test.ts :: sandbox write path counts (#129) > 3 post-boot window.postMessage > 0 parent.postMessage from frame across 600 present write frames | Revert port-only post-boot plugin traffic (no window.postMessage after port) (row-03-port-not-window-postmessage) | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^sandbox write path counts \\(#129\\) > 3 post-boot window\\.postMessage > 0 parent\\.postMessage from frame across 600 present write frames$" --testTimeout=120000 --reporter=json --outputFile.json=<tmp> -- ../src/plugins/sandbox-write-path.counts.test.ts | RED (expected) |
| row-04-batch-split-forty-writes | src/plugins/sandbox-write-path.counts.test.ts :: sandbox write path counts (#129) > 4 batch cap message counts > 40 small writes → 2 port posts (32 + 8 buffers) | Revert splitVizWriteBatch chunking for large viz batches (row-04-batch-split-forty-writes) | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^sandbox write path counts \\(#129\\) > 4 batch cap message counts > 40 small writes → 2 port posts \\(32 \\+ 8 buffers\\)$" --testTimeout=120000 --reporter=json --outputFile.json=<tmp> -- ../src/plugins/sandbox-write-path.counts.test.ts | RED (expected) |
| row-05-viz-batch-shell-reuse | src/plugins/sandbox-write-path.counts.test.ts :: sandbox write path counts (#129) > 5 steady-frame allocation > 600×40 writes → 1200 port posts; same batch object frame 1 and 600 | Revert viz batch shell reuse across display frames (row-05-viz-batch-shell-reuse) | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^sandbox write path counts \\(#129\\) > 5 steady-frame allocation > 600×40 writes → 1200 port posts; same batch object frame 1 and 600$" --testTimeout=120000 --reporter=json --outputFile.json=<tmp> -- ../src/plugins/sandbox-write-path.counts.test.ts | RED (expected) |

### row-01-boot-port-pickup

```
AssertionError: expected false to be true // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
```

### row-02-boot-channel-parent-source

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

### row-03-port-not-window-postmessage

```
AssertionError: expected 600 to be +0 // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
```

### row-04-batch-split-forty-writes

```
AssertionError: expected 1 to be 2 // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
```

### row-05-viz-batch-shell-reuse

```
AssertionError: expected { buffers: [ …(8) ], uniforms: [] } to be { buffers: [], uniforms: [] } // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
```
