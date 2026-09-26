## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| production-only-guard | scripts/revert-proof.dogfood.test.ts :: revert-proof dogfood guards > production-only guard rejects patches touching test files | Disable production-only patch validation | web/node_modules/.bin/vitest run scripts/revert-proof.dogfood.test.ts -t "revert-proof dogfood guards > production-only guard rejects patches touching test files" | RED (expected) |
| production-reach-guard | scripts/revert-proof.dogfood.test.ts :: revert-proof dogfood guards > production reach guard rejects unreachable revert targets | Disable production reach guard so test-only revert targets are accepted | web/node_modules/.bin/vitest run scripts/revert-proof.dogfood.test.ts -t "revert-proof dogfood guards > production reach guard rejects unreachable revert targets" | RED (expected) |
| stays-green-guard | scripts/revert-proof.dogfood.test.ts :: revert-proof dogfood guards > stays-green guard rejects patched green vitest runs | Remove stays-green failure guard so noop reverts are accepted | web/node_modules/.bin/vitest run scripts/revert-proof.dogfood.test.ts -t "revert-proof dogfood guards > stays-green guard rejects patched green vitest runs" | RED (expected) |

### production-only-guard

```
AssertionError: expected [Function] to throw an error
    at Proxy.<anonymous> (file://<tmp>
    at Proxy.<anonymous> (file://<tmp>
    at Proxy.methodWrapper (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
    at file://<tmp>
```

### production-reach-guard

```
AssertionError: expected [Function] to throw an error
    at Proxy.<anonymous> (file://<tmp>
    at Proxy.<anonymous> (file://<tmp>
    at Proxy.methodWrapper (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
    at file://<tmp>
```

### stays-green-guard

```
AssertionError: expected [Function] to throw an error
    at Proxy.<anonymous> (file://<tmp>
    at Proxy.<anonymous> (file://<tmp>
    at Proxy.methodWrapper (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
    at file://<tmp>
```
