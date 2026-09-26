## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| chai-accepted | scripts/revert-proof.lib.test.ts :: revert-proof vitest runner through the overlay > (f) real expect() failures set revertProofAssertion | Drop chai Assertion throw-site branding | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof vitest runner through the overlay > \\(f\\) real expect\\(\\) failures set revertProofAssertion$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| classify-accepts-meta | scripts/revert-proof.lib.test.ts :: strict Vitest red from task.meta only > accepts revertProofAssertion meta | Never classify a vitest failure as assertion red | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^strict Vitest red from task\\.meta only > accepts revertProofAssertion meta$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| classify-green | scripts/revert-proof.lib.test.ts :: strict Vitest red from task.meta only > reports a passing patched test as green | Drop the green classification | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^strict Vitest red from task\\.meta only > reports a passing patched test as green$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| classify-rejects-no-meta | scripts/revert-proof.lib.test.ts :: strict Vitest red from task.meta only > (b) rejects assertion-looking failure without meta flag | Classify every vitest failure as assertion red | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^strict Vitest red from task\\.meta only > \\(b\\) rejects assertion-looking failure without meta flag$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| classify-rejects-plain-meta | scripts/revert-proof.lib.test.ts :: strict Vitest red from task.meta only > (c-meta) rejects plain-object style failures without meta flag | Treat a present-but-false meta flag as assertion red | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^strict Vitest red from task\\.meta only > \\(c-meta\\) rejects plain-object style failures without meta flag$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| meta-spoof-accepted | scripts/revert-proof.lib.test.ts :: revert-proof vitest runner through the overlay > (meta-spoof) test-written task.meta.revertProofAssertion is overwritten | Leave test-writable task.meta instead of a runner-owned frozen verdict | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof vitest runner through the overlay > \\(meta-spoof\\) test-written task\\.meta\\.revertProofAssertion is overwritten$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| node-assert-callable | scripts/revert-proof.lib.test.ts :: revert-proof vitest runner through the overlay > (g-callable) callable node:assert and node:assert/strict failures set revertProofAssertion | Drop the callable node:assert facade alias | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof vitest runner through the overlay > \\(g-callable\\) callable node:assert and node:assert/strict failures set revertProofAssertion$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| passthrough-branded | scripts/revert-proof.lib.test.ts :: revert-proof vitest runner through the overlay > (passthrough) errors handed to an assertion and rethrown are not branded | Brand errors an assertion merely rethrows | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof vitest runner through the overlay > \\(passthrough\\) errors handed to an assertion and rethrown are not branded$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| plain-object-accepted | scripts/revert-proof.lib.test.ts :: revert-proof vitest runner through the overlay > (c) plain-object fake AssertionError is rejected | Count any thrown object as assertion red | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof vitest runner through the overlay > \\(c\\) plain-object fake AssertionError is rejected$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| production-only-guard | scripts/revert-proof.dogfood.test.ts :: revert-proof dogfood guards > production-only guard rejects patches touching test files | Disable production-only patch validation | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof dogfood guards > production-only guard rejects patches touching test files$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.dogfood.test.ts | RED (expected) |
| production-reach-guard | scripts/revert-proof.dogfood.test.ts :: revert-proof dogfood guards > production reach guard rejects unreachable revert targets | Disable production reach guard so test-only revert targets are accepted | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof dogfood guards > production reach guard rejects unreachable revert targets$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.dogfood.test.ts | RED (expected) |
| proto-borrow-accepted | scripts/revert-proof.lib.test.ts :: revert-proof vitest runner through the overlay > (proto-borrow) borrowed prototypes, hand-built and subclassed AssertionErrors are rejected | Accept chai.AssertionError by instanceof again | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof vitest runner through the overlay > \\(proto-borrow\\) borrowed prototypes, hand-built and subclassed AssertionErrors are rejected$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| pytest-accepts-meta | scripts/revert-proof.lib.test.ts :: strict pytest red from plugin JSON only > accepts revertProofAssertion from plugin JSON | Never classify a pytest failure as assertion red | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^strict pytest red from plugin JSON only > accepts revertProofAssertion from plugin JSON$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| pytest-collection-error | scripts/revert-proof.lib.test.ts :: pytest plugin JSON parsing > treats missing JSON on nonzero exit as collection error | Treat missing plugin JSON as a clean run | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^pytest plugin JSON parsing > treats missing JSON on nonzero exit as collection error$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| pytest-rejects-no-meta | scripts/revert-proof.lib.test.ts :: strict pytest red from plugin JSON only > (a) rejects ProbeError even when traceback mentions AssertionError | Classify every pytest failure as assertion red | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^strict pytest red from plugin JSON only > \\(a\\) rejects ProbeError even when traceback mentions AssertionError$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| pytest-target-skipped | scripts/revert-proof.lib.test.ts :: pytest plugin JSON parsing > parses tests array from plugin output | Drop the skipped-target rejection for pytest | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^pytest plugin JSON parsing > parses tests array from plugin output$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| red-line-dropped | scripts/revert-proof.lib.test.ts :: vitest JSON report parsing > (red-line) keeps the first line of the first failure message | Drop the patched failure line from parsed vitest results | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^vitest JSON report parsing > \\(red-line\\) keeps the first line of the first failure message$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| red-not-compared | scripts/revert-proof.lib.test.ts :: sidecar red value > (red-mismatch) a different patched failure line is rejected | Stop comparing the patched failure line to red | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^sidecar red value > \\(red-mismatch\\) a different patched failure line is rejected$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| red-not-required | scripts/revert-proof.lib.test.ts :: sidecar red value > (red-required) sidecar without a string red field is rejected | Stop requiring the red sidecar field | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^sidecar red value > \\(red-required\\) sidecar without a string red field is rejected$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| selection-multiple-matched | scripts/revert-proof.lib.test.ts :: vitest JSON selection by full name > rejects when filter matches multiple executed tests | Drop the multiple-match rejection | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^vitest JSON selection by full name > rejects when filter matches multiple executed tests$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| selection-other-executed | scripts/revert-proof.lib.test.ts :: vitest JSON selection by full name > rejects when another test executed | Drop the other-tests-skipped rejection | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^vitest JSON selection by full name > rejects when another test executed$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| selection-others-skipped | scripts/revert-proof.lib.test.ts :: vitest JSON selection by full name > requires target passed/failed and all others skipped | Count the target itself among tests that must be skipped | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^vitest JSON selection by full name > requires target passed/failed and all others skipped$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| selection-target-skipped | scripts/revert-proof.lib.test.ts :: vitest JSON selection by full name > rejects when target is skipped (it.skipIf / ctx.skip) | Treat a skipped target as executed | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^vitest JSON selection by full name > rejects when target is skipped \\(it\\.skipIf / ctx\\.skip\\)$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| stays-green-guard | scripts/revert-proof.dogfood.test.ts :: revert-proof dogfood guards > stays-green guard rejects patched green vitest runs | Remove stays-green failure guard so noop reverts are accepted | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof dogfood guards > stays-green guard rejects patched green vitest runs$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.dogfood.test.ts | RED (expected) |
| vitest-fullname-ancestors | scripts/revert-proof.lib.test.ts :: vitest JSON report parsing > rebuilds fullName from ancestorTitles and reads meta | Stop rebuilding fullName from ancestorTitles | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^vitest JSON report parsing > rebuilds fullName from ancestorTitles and reads meta$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| node-assert-accepted | | | | **ERROR: row node-assert-accepted: red value mismatch (expected AssertionError: expected false to be true // Object.is equality, got AssertionError: node strictEqual: expected false to be true // Object.is equality)** |

### chai-accepted

```
AssertionError [ERR_ASSERTION]: expect toBe

false !== true

    at revertProofBrandedAssertion (<tmp>
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

### classify-accepts-meta

```
AssertionError: expected 'build break' to be 'assertion' // Object.is equality
    at Proxy.revertProofBrandedAssertion (<tmp>
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

### classify-green

```
AssertionError: expected 'build break' to be 'green' // Object.is equality
    at Proxy.revertProofBrandedAssertion (<tmp>
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

### classify-rejects-no-meta

```
AssertionError: expected 'assertion' to be 'build break' // Object.is equality
    at Proxy.revertProofBrandedAssertion (<tmp>
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

### classify-rejects-plain-meta

```
AssertionError: expected 'assertion' to be 'build break' // Object.is equality
    at Proxy.revertProofBrandedAssertion (<tmp>
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

### meta-spoof-accepted

```
AssertionError: meta body spoof: expected true to be false // Object.is equality
    at Proxy.revertProofBrandedAssertion (<tmp>
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

### node-assert-callable

```
AssertionError: node callable assert: expected false to be true // Object.is equality
    at Proxy.revertProofBrandedAssertion (<tmp>
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

### passthrough-branded

```
AssertionError: node fail passthrough: expected true to be false // Object.is equality
    at Proxy.revertProofBrandedAssertion (<tmp>
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

### plain-object-accepted

```
AssertionError: expected true to be false // Object.is equality
    at Proxy.revertProofBrandedAssertion (<tmp>
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

### production-only-guard

```
AssertionError: expected undefined to be 'row dogfood: patch touches test files…' // Object.is equality
    at Proxy.revertProofBrandedAssertion (<tmp>
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

### production-reach-guard

```
AssertionError: expected undefined to be 'row dogfood: revert target unreachabl…' // Object.is equality
    at Proxy.revertProofBrandedAssertion (<tmp>
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

### proto-borrow-accepted

```
AssertionError: proto borrow: expected true to be false // Object.is equality
    at Proxy.revertProofBrandedAssertion (<tmp>
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

### pytest-accepts-meta

```
AssertionError: expected 'build break' to be 'assertion' // Object.is equality
    at Proxy.revertProofBrandedAssertion (<tmp>
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

### pytest-collection-error

```
AssertionError: expected false to be true // Object.is equality
    at Proxy.revertProofBrandedAssertion (<tmp>
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

### pytest-rejects-no-meta

```
AssertionError: expected 'assertion' to be 'build break' // Object.is equality
    at Proxy.revertProofBrandedAssertion (<tmp>
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

### pytest-target-skipped

```
AssertionError: expected 'other tests not skipped' to be 'target skipped' // Object.is equality
    at Proxy.revertProofBrandedAssertion (<tmp>
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

### red-line-dropped

```
AssertionError: expected null to be 'AssertionError: expected 2 to be 1 //…' // Object.is equality
    at Proxy.revertProofBrandedAssertion (<tmp>
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

### red-not-compared

```
AssertionError: expected undefined to be 'row r: red value mismatch (expected A…' // Object.is equality
    at Proxy.revertProofBrandedAssertion (<tmp>
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

### red-not-required

```
AssertionError: expected undefined to be 'row r: sidecar JSON missing string fi…' // Object.is equality
    at Proxy.revertProofBrandedAssertion (<tmp>
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

### selection-multiple-matched

```
AssertionError: expected true to be false // Object.is equality
    at Proxy.revertProofBrandedAssertion (<tmp>
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

### selection-other-executed

```
AssertionError: expected true to be false // Object.is equality
    at Proxy.revertProofBrandedAssertion (<tmp>
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

### selection-others-skipped

```
AssertionError: expected false to be true // Object.is equality
    at Proxy.revertProofBrandedAssertion (<tmp>
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

### selection-target-skipped

```
AssertionError: expected true to be false // Object.is equality
    at Proxy.revertProofBrandedAssertion (<tmp>
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

### stays-green-guard

```
AssertionError: expected undefined to be 'row dogfood: test stayed GREEN after …' // Object.is equality
    at Proxy.revertProofBrandedAssertion (<tmp>
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

### vitest-fullname-ancestors

```
AssertionError: expected 'returns one' to be 'widget > alpha > returns one' // Object.is equality
    at Proxy.revertProofBrandedAssertion (<tmp>
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
