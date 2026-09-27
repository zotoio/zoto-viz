## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| brand-expect | scripts/revert-proof.lib.test.ts :: revert-proof vitest runner through the overlay > (2) real expect(1).toBe(0) is branded | Brand capture swaps actual and expected | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof vitest runner through the overlay > \\(2\\) real expect\\(1\\)\\.toBe\\(0\\) is branded$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| brand-soft-fail | scripts/revert-proof.lib.test.ts :: revert-proof vitest runner through the overlay > (2) expect.soft failure is branded | Runner ignores the recorded expect.soft() failure | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof vitest runner through the overlay > \\(2\\) expect\\.soft failure is branded$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| brand-soft-red-lazy | scripts/revert-proof.lib.test.ts :: revert-proof vitest runner through the overlay > (2) expect.soft failure is branded | Read red from the error when the runner judges it (after vitest stringified soft values) | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof vitest runner through the overlay > \\(2\\) expect\\.soft failure is branded$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| brand-soft-then-typeerror | scripts/revert-proof.lib.test.ts :: revert-proof vitest runner through the overlay > (2) expect.soft failure then TypeError keeps the first (soft) red | Runner judges the thrown TypeError before the earlier soft failure | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof vitest runner through the overlay > \\(2\\) expect\\.soft failure then TypeError keeps the first \\(soft\\) red$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| brand-typeerror | scripts/revert-proof.lib.test.ts :: revert-proof vitest runner through the overlay > (2) plain TypeError is not branded | Runner accepts any thrown object without the brand check | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof vitest runner through the overlay > \\(2\\) plain TypeError is not branded$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| node-assert-not-branded | scripts/revert-proof.lib.test.ts :: revert-proof vitest runner through the overlay > (3) real node:assert strictEqual is not branded | Remove only the node:assert rejection in noteFailure | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof vitest runner through the overlay > \\(3\\) real node:assert strictEqual is not branded$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| pytest-plugin-assert | scripts/revert-proof.lib.test.ts :: revert-proof pytest plugin > (4-plugin) a failing rewritten assert records its source line as red | Plugin treats traceback Source as str (INTERNALERROR, no report rows) | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof pytest plugin > \\(4-plugin\\) a failing rewritten assert records its source line as red$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| pytest-plugin-raise | scripts/revert-proof.lib.test.ts :: revert-proof pytest plugin > (4-plugin) a hand-raised AssertionError is not an assertion | Plugin accepts any failing statement in the test file, not only rewritten asserts | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof pytest plugin > \\(4-plugin\\) a hand-raised AssertionError is not an assertion$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| runner-meta-only | scripts/revert-proof.lib.test.ts :: revert-proof vitest runner through the overlay > (1) only the runner writes the flag after hooks (meta spoof rejected) | Let test-written task.meta override the runner verdict and red | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof vitest runner through the overlay > \\(1\\) only the runner writes the flag after hooks \\(meta spoof rejected\\)$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.lib.test.ts | RED (expected) |
| classify-accepts-meta | | | | **ERROR: row classify-accepts-meta: git apply --check reported offset or fuzz: Hunk #1 succeeded at 366 (offset 5 lines).** |
| classify-green | | | | **ERROR: row classify-green: git apply --check reported offset or fuzz: Hunk #1 succeeded at 364 (offset 5 lines).** |
| classify-rejects-no-meta | | | | **ERROR: row classify-rejects-no-meta: git apply --check reported offset or fuzz: Hunk #1 succeeded at 366 (offset 5 lines).** |
| classify-rejects-plain-meta | | | | **ERROR: row classify-rejects-plain-meta: git apply --check reported offset or fuzz: Hunk #1 succeeded at 366 (offset 5 lines).** |
| production-only-guard | | | | **ERROR: row production-only-guard: git apply --check reported offset or fuzz: Hunk #1 succeeded at 442 (offset -2 lines).** |
| production-reach-guard | | | | **ERROR: row production-reach-guard: git apply --check reported offset or fuzz: Hunk #1 succeeded at 915 (offset 109 lines).** |
| pytest-accepts-meta | | | | **ERROR: row pytest-accepts-meta: git apply --check reported offset or fuzz: Hunk #1 succeeded at 429 (offset 5 lines).** |
| pytest-assert-vs-raise | | | | **ERROR: row pytest-assert-vs-raise: git apply --check reported offset or fuzz: Hunk #1 succeeded at 429 (offset 5 lines).** |
| pytest-collection-error | | | | **ERROR: row pytest-collection-error: git apply --check reported offset or fuzz: Hunk #1 succeeded at 390 (offset 5 lines).** |
| pytest-red-carried | | | | **ERROR: row pytest-red-carried: git apply --check reported offset or fuzz: Hunk #1 succeeded at 380 (offset 5 lines).** |
| pytest-rejects-no-meta | | | | **ERROR: row pytest-rejects-no-meta: git apply --check reported offset or fuzz: Hunk #1 succeeded at 429 (offset 5 lines).** |
| pytest-target-skipped | | | | **ERROR: row pytest-target-skipped: git apply --check reported offset or fuzz: Hunk #1 succeeded at 412 (offset 5 lines).** |
| red-line-dropped | | | | **ERROR: row red-line-dropped: git apply --check reported offset or fuzz: Hunk #1 succeeded at 323 (offset 5 lines).** |
| red-not-compared | | | | **ERROR: row red-not-compared: baseline test selection failed (target not found; never a pass) --- baseline output --- JSON report written to <tmp>** |
| red-not-required | | | | **ERROR: row red-not-required: baseline test selection failed (target not found; never a pass) --- baseline output --- JSON report written to <tmp>** |
| red-pytest-shape | | | | **ERROR: row red-pytest-shape: baseline test selection failed (target not found; never a pass) --- baseline output --- JSON report written to <tmp>** |
| red-string-accepted | | | | **ERROR: row red-string-accepted: baseline test selection failed (target not found; never a pass) --- baseline output --- JSON report written to <tmp>** |
| red-vitest-shape | | | | **ERROR: row red-vitest-shape: baseline test selection failed (target not found; never a pass) --- baseline output --- JSON report written to <tmp>** |
| selection-multiple-matched | | | | **ERROR: row selection-multiple-matched: git apply --check reported offset or fuzz: Hunk #1 succeeded at 342 (offset 5 lines).** |
| selection-other-executed | | | | **ERROR: row selection-other-executed: git apply --check reported offset or fuzz: Hunk #1 succeeded at 353 (offset 5 lines).** |
| selection-others-skipped | | | | **ERROR: row selection-others-skipped: git apply --check reported offset or fuzz: Hunk #1 succeeded at 353 (offset 5 lines).** |
| selection-target-skipped | | | | **ERROR: row selection-target-skipped: git apply --check reported offset or fuzz: Hunk #1 succeeded at 336 (offset 5 lines).** |
| stays-green-guard | | | | **ERROR: row stays-green-guard: git apply --check reported offset or fuzz: Hunk #1 succeeded at 1035 (offset 109 lines).** |
| strict-git-apply | | | | **ERROR: row strict-git-apply: git apply --check reported offset or fuzz: Hunk #1 succeeded at 1076 (offset 109 lines).** |
| vitest-fullname-ancestors | | | | **ERROR: row vitest-fullname-ancestors: git apply --check reported offset or fuzz: Hunk #1 succeeded at 289 (offset 5 lines).** |
| vitest-red-parsed | | | | **ERROR: row vitest-red-parsed: git apply --check reported offset or fuzz: Hunk #1 succeeded at 316 (offset 5 lines).** |

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

### node-assert-not-branded

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
