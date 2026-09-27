## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| brand-expect | scripts/revert-proof.lib.test.ts :: revert-proof vitest runner through the overlay > (2) real expect(1).toBe(0) is branded | Brand capture swaps actual and expected | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof vitest runner through the overlay > \\(2\\) real expect\\(1\\)\\.toBe\\(0\\) is branded$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| brand-soft-fail | scripts/revert-proof.lib.test.ts :: revert-proof vitest runner through the overlay > (2) expect.soft failure is branded | Runner ignores the recorded expect.soft() failure | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof vitest runner through the overlay > \\(2\\) expect\\.soft failure is branded$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| brand-soft-pass-then-typeerror | scripts/revert-proof.lib.test.ts :: revert-proof vitest runner through the overlay > (2) expect.soft pass then TypeError is not branded | Runner accepts a TypeError thrown after a passing expect.soft() | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof vitest runner through the overlay > \\(2\\) expect\\.soft pass then TypeError is not branded$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| brand-soft-red-lazy | scripts/revert-proof.lib.test.ts :: revert-proof vitest runner through the overlay > (2) expect.soft failure is branded | Read red from the error when the runner judges it (after vitest stringified soft values) | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof vitest runner through the overlay > \\(2\\) expect\\.soft failure is branded$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| brand-soft-then-typeerror | scripts/revert-proof.lib.test.ts :: revert-proof vitest runner through the overlay > (2) expect.soft failure then TypeError keeps the first (soft) red | Runner judges the thrown TypeError before the earlier soft failure | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof vitest runner through the overlay > \\(2\\) expect\\.soft failure then TypeError keeps the first \\(soft\\) red$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| brand-typeerror | scripts/revert-proof.lib.test.ts :: revert-proof vitest runner through the overlay > (2) plain TypeError is not branded | Runner accepts any thrown object without the brand check | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof vitest runner through the overlay > \\(2\\) plain TypeError is not branded$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| classify-accepts-meta | scripts/revert-proof.lib.test.ts :: strict Vitest red from task.meta only > accepts revertProofAssertion meta | Never classify a vitest failure as an assertion | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^strict Vitest red from task\\.meta only > accepts revertProofAssertion meta$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| classify-green | scripts/revert-proof.lib.test.ts :: strict Vitest red from task.meta only > reports a passing patched test as green | Drop the green classification | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^strict Vitest red from task\\.meta only > reports a passing patched test as green$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| classify-rejects-no-meta | scripts/revert-proof.lib.test.ts :: strict Vitest red from task.meta only > (b) rejects assertion-looking failure without meta flag | Classify every vitest failure as an assertion | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^strict Vitest red from task\\.meta only > \\(b\\) rejects assertion-looking failure without meta flag$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| classify-rejects-plain-meta | scripts/revert-proof.lib.test.ts :: strict Vitest red from task.meta only > (c-meta) rejects plain-object style failures without meta flag | Accept any present revertProofAssertion value, not just true | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^strict Vitest red from task\\.meta only > \\(c-meta\\) rejects plain-object style failures without meta flag$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| node-assert-not-branded | scripts/revert-proof.lib.test.ts :: revert-proof vitest runner through the overlay > (3) real node:assert strictEqual is not branded | Runner accepts any thrown object without the brand check (node:assert must stay rejected) | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof vitest runner through the overlay > \\(3\\) real node:assert strictEqual is not branded$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| production-only-guard | scripts/revert-proof.dogfood.test.ts :: revert-proof dogfood guards > production-only guard rejects patches touching test files | Disable production-only patch validation | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof dogfood guards > production-only guard rejects patches touching test files$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.dogfood.test.ts | RED (expected) |
| production-reach-guard | scripts/revert-proof.dogfood.test.ts :: revert-proof dogfood guards > production reach guard rejects unreachable revert targets | Disable production reach guard so test-only revert targets are accepted | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof dogfood guards > production reach guard rejects unreachable revert targets$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.dogfood.test.ts | RED (expected) |
| pytest-accepts-meta | scripts/revert-proof.lib.test.ts :: strict pytest red from plugin JSON only > accepts revertProofAssertion from plugin JSON | Never classify a pytest failure as an assertion | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^strict pytest red from plugin JSON only > accepts revertProofAssertion from plugin JSON$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| pytest-assert-vs-raise | scripts/revert-proof.lib.test.ts :: strict pytest red from plugin JSON only > (4) accepts rewritten assert, rejects hand-raised AssertionError | Accept any present pytest revertProofAssertion value, not just true | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^strict pytest red from plugin JSON only > \\(4\\) accepts rewritten assert, rejects hand-raised AssertionError$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| pytest-collection-error | scripts/revert-proof.lib.test.ts :: pytest plugin JSON parsing > treats missing JSON on nonzero exit as collection error | Treat missing plugin JSON as a clean run | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^pytest plugin JSON parsing > treats missing JSON on nonzero exit as collection error$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| pytest-plugin-assert | scripts/revert-proof.lib.test.ts :: revert-proof pytest plugin > (4-plugin) a failing rewritten assert records its source line as red | Plugin treats traceback Source as str (INTERNALERROR, no report rows) | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof pytest plugin > \\(4-plugin\\) a failing rewritten assert records its source line as red$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| pytest-plugin-raise | scripts/revert-proof.lib.test.ts :: revert-proof pytest plugin > (4-plugin) a hand-raised AssertionError is not an assertion | Plugin accepts any failing statement in the test file, not only rewritten asserts | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof pytest plugin > \\(4-plugin\\) a hand-raised AssertionError is not an assertion$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| pytest-red-carried | scripts/revert-proof.lib.test.ts :: pytest plugin JSON parsing > selection target carries structured revertProofRed from plugin JSON | Drop revertProofRed when normalizing pytest plugin rows | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^pytest plugin JSON parsing > selection target carries structured revertProofRed from plugin JSON$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| pytest-rejects-no-meta | scripts/revert-proof.lib.test.ts :: strict pytest red from plugin JSON only > (a) rejects ProbeError even when traceback mentions AssertionError | Classify every pytest failure as an assertion | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^strict pytest red from plugin JSON only > \\(a\\) rejects ProbeError even when traceback mentions AssertionError$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| pytest-target-skipped | scripts/revert-proof.lib.test.ts :: pytest plugin JSON parsing > parses tests array from plugin output | Drop the skipped-target rejection for pytest | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^pytest plugin JSON parsing > parses tests array from plugin output$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| red-line-dropped | scripts/revert-proof.lib.test.ts :: vitest JSON report parsing > (red-line) keeps the first line of the first failure message | Drop the failure message first line | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^vitest JSON report parsing > \\(red-line\\) keeps the first line of the first failure message$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| red-not-compared | scripts/revert-proof.lib.test.ts :: sidecar red value > (5-red-mismatch) structured actual/expected mismatch is rejected | Compare only red.expected, ignoring actual | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^sidecar red value > \\(5-red-mismatch\\) structured actual/expected mismatch is rejected$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| red-not-required | scripts/revert-proof.lib.test.ts :: sidecar red value > (5-red-required) sidecar without structured red is rejected | Stop validating the red sidecar field | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^sidecar red value > \\(5-red-required\\) sidecar without structured red is rejected$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| red-pytest-shape | scripts/revert-proof.lib.test.ts :: sidecar red value > (5-red-shape) pytest red must be the rewritten assert source | Drop the pytest { assert } shape check | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^sidecar red value > \\(5-red-shape\\) pytest red must be the rewritten assert source$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| red-string-accepted | scripts/revert-proof.lib.test.ts :: sidecar red value > (5-red-shape) vitest red given as a message string is rejected | Accept a non-object red (message string) | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^sidecar red value > \\(5-red-shape\\) vitest red given as a message string is rejected$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| red-vitest-shape | scripts/revert-proof.lib.test.ts :: sidecar red value > (5-red-shape) vitest red without actual/expected is rejected | Drop the vitest { actual, expected } shape check | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^sidecar red value > \\(5-red-shape\\) vitest red without actual/expected is rejected$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| runner-meta-only | scripts/revert-proof.lib.test.ts :: revert-proof vitest runner through the overlay > (1) only the runner writes the flag after hooks (meta spoof rejected) | Let test-written task.meta override the runner verdict and red | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof vitest runner through the overlay > \\(1\\) only the runner writes the flag after hooks \\(meta spoof rejected\\)$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| selection-multiple-matched | scripts/revert-proof.lib.test.ts :: vitest JSON selection by full name > rejects when filter matches multiple executed tests | Drop the multiple-match rejection | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^vitest JSON selection by full name > rejects when filter matches multiple executed tests$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| selection-other-executed | scripts/revert-proof.lib.test.ts :: vitest JSON selection by full name > rejects when another test executed | Drop the other-tests-skipped rejection | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^vitest JSON selection by full name > rejects when another test executed$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| selection-others-skipped | scripts/revert-proof.lib.test.ts :: vitest JSON selection by full name > requires target passed/failed and all others skipped | Count the target itself among tests that must be skipped | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^vitest JSON selection by full name > requires target passed/failed and all others skipped$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| selection-target-skipped | scripts/revert-proof.lib.test.ts :: vitest JSON selection by full name > rejects when target is skipped (it.skipIf / ctx.skip) | Treat a skipped target as executed | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^vitest JSON selection by full name > rejects when target is skipped \\(it\\.skipIf / ctx\\.skip\\)$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| stays-green-guard | scripts/revert-proof.dogfood.test.ts :: revert-proof dogfood guards > stays-green guard rejects patched green vitest runs | Remove stays-green failure guard so noop reverts are accepted | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof dogfood guards > stays-green guard rejects patched green vitest runs$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.dogfood.test.ts | RED (expected) |
| vitest-fullname-ancestors | scripts/revert-proof.lib.test.ts :: vitest JSON report parsing > rebuilds fullName from ancestorTitles and reads meta | Stop rebuilding fullName from ancestorTitles | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^vitest JSON report parsing > rebuilds fullName from ancestorTitles and reads meta$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| vitest-red-parsed | scripts/revert-proof.lib.test.ts :: vitest JSON report parsing > reads structured revertProofRed from task meta | Drop revertProofRed when parsing the vitest JSON report | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^vitest JSON report parsing > reads structured revertProofRed from task meta$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |

### brand-expect

```
AssertionError: expected { actual: +0, expected: 1 } to deeply equal { actual: 1, expected: +0 }
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

### brand-soft-fail

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

### brand-soft-pass-then-typeerror

```
AssertionError: expected true to be false // Object.is equality
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

### brand-soft-red-lazy

```
AssertionError: expected { actual: '1', expected: '0' } to deeply equal { actual: 1, expected: +0 }
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

### brand-soft-then-typeerror

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

### brand-typeerror

```
AssertionError: expected true to be false // Object.is equality
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

### classify-accepts-meta

```
AssertionError: expected 'build break' to be 'assertion' // Object.is equality
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

### classify-green

```
AssertionError: expected 'build break' to be 'green' // Object.is equality
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

### classify-rejects-no-meta

```
AssertionError: expected 'assertion' to be 'build break' // Object.is equality
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

### classify-rejects-plain-meta

```
AssertionError: expected 'assertion' to be 'build break' // Object.is equality
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

### node-assert-not-branded

```
AssertionError: expected true to be false // Object.is equality
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

### production-only-guard

```
AssertionError: expected undefined to be 'row dogfood: patch touches test files…' // Object.is equality
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

### production-reach-guard

```
AssertionError: expected undefined to be 'row dogfood: revert target unreachabl…' // Object.is equality
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

### pytest-accepts-meta

```
AssertionError: expected 'build break' to be 'assertion' // Object.is equality
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

### pytest-assert-vs-raise

```
AssertionError: expected 'assertion' to be 'build break' // Object.is equality
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

### pytest-collection-error

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

### pytest-plugin-assert

```
AssertionError: expected null to deeply equal { …(4) }
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

### pytest-plugin-raise

```
AssertionError: expected { …(4) } to deeply equal { …(4) }
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

### pytest-red-carried

```
AssertionError: expected null to deeply equal { assert: 'assert answer == 2' }
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

### pytest-rejects-no-meta

```
AssertionError: expected 'assertion' to be 'build break' // Object.is equality
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

### pytest-target-skipped

```
AssertionError: expected 'other tests not skipped' to be 'target skipped' // Object.is equality
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

### red-line-dropped

```
AssertionError: expected null to be 'AssertionError: expected 2 to be 1 //…' // Object.is equality
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

### red-not-compared

```
AssertionError: expected undefined to be 'row r: red value mismatch (expected {…' // Object.is equality
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

### red-not-required

```
AssertionError: expected undefined to be 'row r: sidecar JSON missing object fi…' // Object.is equality
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

### red-pytest-shape

```
AssertionError: expected undefined to be 'row r: pytest red must be { assert: "…' // Object.is equality
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

### red-string-accepted

```
AssertionError: expected 'row r: vitest red must be { actual, e…' to be 'row r: sidecar JSON missing object fi…' // Object.is equality
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

### red-vitest-shape

```
AssertionError: expected undefined to be 'row r: vitest red must be { actual, e…' // Object.is equality
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

### runner-meta-only

```
AssertionError: expected true to be false // Object.is equality
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

### selection-multiple-matched

```
AssertionError: expected true to be false // Object.is equality
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

### selection-other-executed

```
AssertionError: expected true to be false // Object.is equality
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

### selection-others-skipped

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

### selection-target-skipped

```
AssertionError: expected true to be false // Object.is equality
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

### stays-green-guard

```
AssertionError: expected undefined to be 'row dogfood: test stayed GREEN after …' // Object.is equality
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

### vitest-fullname-ancestors

```
AssertionError: expected 'returns one' to be 'widget > alpha > returns one' // Object.is equality
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

### vitest-red-parsed

```
AssertionError: expected null to deeply equal { actual: 2, expected: 1 }
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
