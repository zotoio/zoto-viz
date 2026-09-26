## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| production-only-guard | scripts/revert-proof.dogfood.test.ts :: revert-proof dogfood guards > production-only guard rejects patches touching test files | Disable production-only patch validation | /tmp/revert-proof-wt-workspace-170338/web/node_modules/.bin/vitest run --config scripts/vitest.config.mjs -t "^revert-proof dogfood guards > production-only guard rejects patches touching test files$" --reporter=json --outputFile.json=/tmp/revert-proof-artifacts-IZmEql/production-only-guard-patched-vitest.json --reporter=junit --outputFile.junit=/tmp/revert-proof-artifacts-IZmEql/production-only-guard-patched-vitest.xml -- scripts/revert-proof.dogfood.test.ts | RED (expected) |
| production-reach-guard | scripts/revert-proof.dogfood.test.ts :: revert-proof dogfood guards > production reach guard rejects unreachable revert targets | Disable production reach guard so test-only revert targets are accepted | /tmp/revert-proof-wt-workspace-170338/web/node_modules/.bin/vitest run --config scripts/vitest.config.mjs -t "^revert-proof dogfood guards > production reach guard rejects unreachable revert targets$" --reporter=json --outputFile.json=/tmp/revert-proof-artifacts-IZmEql/production-reach-guard-patched-vitest.json --reporter=junit --outputFile.junit=/tmp/revert-proof-artifacts-IZmEql/production-reach-guard-patched-vitest.xml -- scripts/revert-proof.dogfood.test.ts | RED (expected) |
| stays-green-guard | scripts/revert-proof.dogfood.test.ts :: revert-proof dogfood guards > stays-green guard rejects patched green vitest runs | Remove stays-green failure guard so noop reverts are accepted | /tmp/revert-proof-wt-workspace-170338/web/node_modules/.bin/vitest run --config scripts/vitest.config.mjs -t "^revert-proof dogfood guards > stays-green guard rejects patched green vitest runs$" --reporter=json --outputFile.json=/tmp/revert-proof-artifacts-IZmEql/stays-green-guard-patched-vitest.json --reporter=junit --outputFile.junit=/tmp/revert-proof-artifacts-IZmEql/stays-green-guard-patched-vitest.xml -- scripts/revert-proof.dogfood.test.ts | RED (expected) |

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
