## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| performance-now-wall-clock | `src/plugins/dogfood.test.ts` :: `fat-LAN live soak: termNow must not read wall clock` | Restoring `performance.now()` in hn-term frame seconds reads wall clock during soak | `vitest run src/plugins/dogfood.test.ts -t "termNow must not read wall clock"` | RED (expected) |
| lastT-zero-start | `src/plugins/dogfood.test.ts` :: `hn-term frame.t backward step: dt guard uses 1/60 fallback` | Restoring `lastT=0` start loses real `1/30` dt on the second frame (typed count −1) | `vitest run src/plugins/dogfood.test.ts -t "backward step"` | RED (expected) |

### performance-now-wall-clock

**GREEN (baseline at PR head, patch not applied)**

```
 RUN  v5.0.0 /workspace/web

 Test Files  1 passed (1)
      Tests  1 passed | 24 skipped (25)
```

**RED (with `performance-now-wall-clock.patch` applied)**

```
AssertionError: expected "now" to be called +0 times, but got 120 times
 ❯ src/plugins/dogfood.test.ts:297:28
```

### lastT-zero-start

**GREEN (baseline at PR head, patch not applied)**

```
 RUN  v5.0.0 /workspace/web

 Test Files  1 passed (1)
      Tests  1 passed | 24 skipped (25)
```

**RED (with `lastT-zero-start.patch` applied)**

```
AssertionError: expected 18 to be 19 // Object.is equality
 ❯ src/plugins/dogfood.test.ts:238:64
```

Typed-count delta: **19 − 18 = 1** (exact difference from losing real `1/30` dt on the second frame).
