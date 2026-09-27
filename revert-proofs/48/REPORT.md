## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| brand-expect | scripts/revert-proof.lib.test.ts :: revert-proof vitest runner through the overlay > (2) real expect(1).toBe(0) is branded | Brand capture swaps actual and expected | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof vitest runner through the overlay > \\(2\\) real expect\\(1\\)\\.toBe\\(0\\) is branded$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| brand-soft-pass-then-typeerror | scripts/revert-proof.lib.test.ts :: revert-proof vitest runner through the overlay > (2) expect.soft pass then TypeError is not branded | Runner accepts a TypeError thrown after a passing expect.soft() | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof vitest runner through the overlay > \\(2\\) expect\\.soft pass then TypeError is not branded$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| brand-soft-red-lazy | scripts/revert-proof.lib.test.ts :: revert-proof vitest runner through the overlay > (2) expect.soft failure is branded | Read red from the error when the runner judges it (after vitest stringified soft values) | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof vitest runner through the overlay > \\(2\\) expect\\.soft failure is branded$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| brand-typeerror | scripts/revert-proof.lib.test.ts :: revert-proof vitest runner through the overlay > (2) plain TypeError is not branded | Runner accepts any thrown object without the brand check | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof vitest runner through the overlay > \\(2\\) plain TypeError is not branded$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| pytest-plugin-assert | scripts/revert-proof.lib.test.ts :: revert-proof pytest plugin > (4-plugin) a failing rewritten assert records its source line as red | Plugin treats traceback Source as str (INTERNALERROR, no report rows) | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof pytest plugin > \\(4-plugin\\) a failing rewritten assert records its source line as red$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| pytest-plugin-raise | scripts/revert-proof.lib.test.ts :: revert-proof pytest plugin > (4-plugin) a hand-raised AssertionError is not an assertion | Plugin accepts any failing statement in the test file, not only rewritten asserts | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof pytest plugin > \\(4-plugin\\) a hand-raised AssertionError is not an assertion$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| red-not-compared | scripts/revert-proof.lib.test.ts :: sidecar red value > (5-red-mismatch) structured actual/expected mismatch is rejected | Compare only red.expected, ignoring actual | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^sidecar red value > \\(5-red-mismatch\\) structured actual/expected mismatch is rejected$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| red-not-required | scripts/revert-proof.lib.test.ts :: sidecar red value > (5-red-required) sidecar without structured red is rejected | Stop validating the red sidecar field | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^sidecar red value > \\(5-red-required\\) sidecar without structured red is rejected$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| red-pytest-shape | scripts/revert-proof.lib.test.ts :: sidecar red value > (5-red-shape) pytest red must be the rewritten assert source | Drop the pytest { assert } shape check | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^sidecar red value > \\(5-red-shape\\) pytest red must be the rewritten assert source$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| red-string-accepted | scripts/revert-proof.lib.test.ts :: sidecar red value > (5-red-shape) vitest red given as a message string is rejected | Accept a non-object red (message string) | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^sidecar red value > \\(5-red-shape\\) vitest red given as a message string is rejected$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| red-vitest-shape | scripts/revert-proof.lib.test.ts :: sidecar red value > (5-red-shape) vitest red without actual/expected is rejected | Drop the vitest { actual, expected } shape check | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^sidecar red value > \\(5-red-shape\\) vitest red without actual/expected is rejected$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| vitest-fullname-ancestors | scripts/revert-proof.lib.test.ts :: vitest JSON report parsing > rebuilds fullName from ancestorTitles and reads meta | Stop rebuilding fullName from ancestorTitles | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^vitest JSON report parsing > rebuilds fullName from ancestorTitles and reads meta$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| brand-soft-fail | | | | **ERROR: row brand-soft-fail: git apply --check reported offset or fuzz: Hunk #1 succeeded at 56 (offset 16 lines).** |
| brand-soft-then-typeerror | | | | **ERROR: row brand-soft-then-typeerror: git apply --check reported offset or fuzz: Hunk #1 succeeded at 57 (offset 16 lines).** |
| classify-accepts-meta | | | | **ERROR: row classify-accepts-meta: git apply --check reported offset or fuzz: Hunk #1 succeeded at 361 (offset 1 line).** |
| classify-green | | | | **ERROR: row classify-green: git apply --check reported offset or fuzz: Hunk #1 succeeded at 359 (offset 1 line).** |
| classify-rejects-no-meta | | | | **ERROR: row classify-rejects-no-meta: git apply --check reported offset or fuzz: Hunk #1 succeeded at 361 (offset 1 line).** |
| classify-rejects-plain-meta | | | | **ERROR: row classify-rejects-plain-meta: git apply --check reported offset or fuzz: Hunk #1 succeeded at 361 (offset 1 line).** |
| node-assert-not-branded | | | | **ERROR: row node-assert-not-branded: red value mismatch (expected {"actual":false,"expected":true}, got {"actual":true,"expected":false})** |
| production-only-guard | | | | **ERROR: row production-only-guard: git apply --check reported offset or fuzz: Hunk #1 succeeded at 437 (offset 1 line).** |
| production-reach-guard | | | | **ERROR: row production-reach-guard: git apply --check reported offset or fuzz: Hunk #1 succeeded at 806 (offset 1 line).** |
| pytest-accepts-meta | | | | **ERROR: row pytest-accepts-meta: git apply --check reported offset or fuzz: Hunk #1 succeeded at 424 (offset 1 line).** |
| pytest-assert-vs-raise | | | | **ERROR: row pytest-assert-vs-raise: git apply --check reported offset or fuzz: Hunk #1 succeeded at 424 (offset 1 line).** |
| pytest-collection-error | | | | **ERROR: row pytest-collection-error: git apply --check reported offset or fuzz: Hunk #1 succeeded at 385 (offset 1 line).** |
| pytest-red-carried | | | | **ERROR: row pytest-red-carried: git apply --check reported offset or fuzz: Hunk #1 succeeded at 375 (offset 1 line).** |
| pytest-rejects-no-meta | | | | **ERROR: row pytest-rejects-no-meta: git apply --check reported offset or fuzz: Hunk #1 succeeded at 424 (offset 1 line).** |
| pytest-target-skipped | | | | **ERROR: row pytest-target-skipped: git apply --check reported offset or fuzz: Hunk #1 succeeded at 407 (offset 1 line).** |
| red-line-dropped | | | | **ERROR: row red-line-dropped: git apply --check reported offset or fuzz: Hunk #1 succeeded at 318 (offset 1 line).** |
| runner-meta-only | | | | **ERROR: row runner-meta-only: git apply --check reported offset or fuzz: Hunk #1 succeeded at 74 (offset 1 line).** |
| selection-multiple-matched | | | | **ERROR: row selection-multiple-matched: git apply --check reported offset or fuzz: Hunk #1 succeeded at 337 (offset 1 line).** |
| selection-other-executed | | | | **ERROR: row selection-other-executed: git apply --check reported offset or fuzz: Hunk #1 succeeded at 348 (offset 1 line).** |
| selection-others-skipped | | | | **ERROR: row selection-others-skipped: git apply --check reported offset or fuzz: Hunk #1 succeeded at 348 (offset 1 line).** |
| selection-target-skipped | | | | **ERROR: row selection-target-skipped: git apply --check reported offset or fuzz: Hunk #1 succeeded at 331 (offset 1 line).** |
| stays-green-guard | | | | **ERROR: row stays-green-guard: git apply --check reported offset or fuzz: Hunk #1 succeeded at 926 (offset 1 line).** |
| vitest-red-parsed | | | | **ERROR: row vitest-red-parsed: git apply --check reported offset or fuzz: Hunk #1 succeeded at 311 (offset 1 line).** |

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
