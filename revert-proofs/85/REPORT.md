## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| allow-type-error-truthy | scripts/revert-proof.test.ts :: revert-proof-lib guards > (allowTypeError-strict) string false does not enable allowTypeError | Treat any truthy allowTypeError as enabled | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof-lib guards > \\(allowTypeError-strict\\) string false does not enable allowTypeError$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| bad-patch-reject-fallback | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (c2) patch that does not apply cleanly fails the row | Apply patches with --reject (partial hunks) | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(c2\\) patch that does not apply cleanly fails the row$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| build-break-not-detected | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > syntax break in production module is rejected as build break | Drop the build-break check on the patched run | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > syntax break in production module is rejected as build break$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| describe-gt-fullname | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (j2) describe title containing literal ' > ' selects exactly one test | Stop rebuilding fullName from ancestorTitles | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(j2\\) describe title containing literal ' > ' selects exactly one test$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| editable-python-unchecked | scripts/revert-proof.test.ts :: isolation guards > rejects editable python resolving outside the worktree | Drop the editable-install realpath check | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^isolation guards > rejects editable python resolving outside the worktree$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| escape-dot-dropped | scripts/revert-proof.test.ts :: vitest testName escaping > escapes and anchors fullTestName for -t | Stop escaping `.` in the -t pattern | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^vitest testName escaping > escapes and anchors fullTestName for -t$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| expect-red-swapped | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (f) real expect() failure is RED with revertProofAssertion meta | Brand capture swaps actual and expected | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(f\\) real expect\\(\\) failure is RED with revertProofAssertion meta$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| fullname-selection-leaf | scripts/revert-proof.test.ts :: vitest testName escaping > parseVitestJsonReport rebuilds fullName for selection | Stop rebuilding fullName from ancestorTitles | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^vitest testName escaping > parseVitestJsonReport rebuilds fullName for selection$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| green-class-dropped | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (vitest-green-class) classifyPatchedVitest reports green when patched passes | Drop the green classification | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(vitest-green-class\\) classifyPatchedVitest reports green when patched passes$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| hang-timeout-ignored | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (hang-timeout) hanging test is rejected as timeout | Stop reporting baseline timeouts | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(hang-timeout\\) hanging test is rejected as timeout$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| json-multi-fullname | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (vitest-json-multi) JSON report selects one executed test among skipped siblings | Select by leaf title instead of full name | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(vitest-json-multi\\) JSON report selects one executed test among skipped siblings$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| main-checkout-links-unchecked | scripts/revert-proof.test.ts :: isolation guards > (link-guard-main) rejects symlinks into the main checkout | Skip unscoped packages in the workspace link check | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^isolation guards > \\(link-guard-main\\) rejects symlinks into the main checkout$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| meta-spoof-accepted | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (meta-spoof) test-written revertProofAssertion with a TypeError is rejected | Let test-written task.meta override the runner verdict and red | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(meta-spoof\\) test-written revertProofAssertion with a TypeError is rejected$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| multi-file-no-filter | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (e) multi-test-file row runs exactly one test in a file with many tests | Stop passing the -t name filter to vitest | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(e\\) multi-test-file row runs exactly one test in a file with many tests$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| no-match-accepted | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > filter matching zero tests is rejected on baseline | Accept a selection that matched no test | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > filter matching zero tests is rejected on baseline$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| phantom-leaf-leaf-match | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (phantom-leaf) sidecar full name must match JSON selection | Match the sidecar by leaf title only | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(phantom-leaf\\) sidecar full name must match JSON selection$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| pr-number-unchecked | scripts/revert-proof.test.ts :: revert-proof-lib guards > (pr-number) rejects path traversal PR numbers | Drop PR number validation | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof-lib guards > \\(pr-number\\) rejects path traversal PR numbers$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| prod-reached-unreachable | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (n) revert patch on production-reached module is accepted | Treat every revert target as unreachable | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(n\\) revert patch on production-reached module is accepted$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| py-editable-main-cwd | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (py-editable) editable install row goes red only with worktree isolation | Run pytest rows from the main checkout instead of the worktree | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(py-editable\\) editable install row goes red only with worktree isolation$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| py-raise-accepted | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (py-raise) hand-raised AssertionError is rejected, not counted as assert red | Plugin accepts any failing statement in the test file, not only rewritten asserts | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(py-raise\\) hand-raised AssertionError is rejected, not counted as assert red$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| pytest-and-split | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (l) pytest node id with a and b id selects one test | Split the pytest node id on spaces | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(l\\) pytest node id with a and b id selects one test$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| pytest-brackets-stripped | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (k) pytest node id with bracket parametrize id selects one test | Strip the parametrize id from pytest node ids | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(k\\) pytest node id with bracket parametrize id selects one test$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| pytest-error-unknown | scripts/revert-proof.test.ts :: revert-proof-lib guards > (pytest-error-tag) error outcome is not assertion red | Drop the pytest error-outcome classification | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof-lib guards > \\(pytest-error-tag\\) error outcome is not assertion red$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| pytest-json-collection-clean | scripts/revert-proof.test.ts :: revert-proof-lib guards > (pytest-json-collection) missing JSON on nonzero exit is collection error | Treat missing plugin JSON as a clean run | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof-lib guards > \\(pytest-json-collection\\) missing JSON on nonzero exit is collection error$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| pytest-json-skip-dropped | scripts/revert-proof.test.ts :: revert-proof-lib guards > (pytest-json) plugin JSON lists pass/fail/skip outcomes | Drop the skipped-target rejection for pytest | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof-lib guards > \\(pytest-json\\) plugin JSON lists pass/fail/skip outcomes$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| pytest-node-id-stripped | scripts/revert-proof.test.ts :: vitest testName escaping > builds pytest node ids | Strip the parametrize id from pytest node ids | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^vitest testName escaping > builds pytest node ids$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| pytest-probe-error-accepted | scripts/revert-proof.test.ts :: revert-proof-lib guards > (pytest-probe-error) failed without revertProofAssertion meta is build break | Classify every pytest failure as assertion red | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof-lib guards > \\(pytest-probe-error\\) failed without revertProofAssertion meta is build break$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| pytest-uses-k | scripts/revert-proof.test.ts :: revert-proof-lib guards > (pytest-no-k) buildPytestArgv never uses -k or junitxml | Select pytest tests with -k | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof-lib guards > \\(pytest-no-k\\) buildPytestArgv never uses -k or junitxml$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| python-env-no-pythonpath | scripts/revert-proof.test.ts :: revert-proof-lib guards > (python-env) PYTHONPATH is set to worktree | Stop pointing PYTHONPATH at the worktree | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof-lib guards > \\(python-env\\) PYTHONPATH is set to worktree$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| python-module-unchecked | scripts/revert-proof.test.ts :: revert-proof-lib guards > (pythonModule) rejects injection in pythonModule | Drop pythonModule validation | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof-lib guards > \\(pythonModule\\) rejects injection in pythonModule$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| reach-exempt-ignored | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (reach-exempt-first) reachExempt from config applies before first touched file | Ignore reachExempt from revert-proof-production.json | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(reach-exempt-first\\) reachExempt from config applies before first touched file$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| red-not-compared | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (red-mismatch) a patched failure that differs from the sidecar red is rejected | Compare only red.expected, ignoring actual | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(red-mismatch\\) a patched failure that differs from the sidecar red is rejected$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| regex-title-unescaped | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (j) testName with regex metacharacters selects exactly one test | Pass the sidecar name to -t without escaping | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(j\\) testName with regex metacharacters selects exactly one test$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| scoped-links-unchecked | scripts/revert-proof.test.ts :: isolation guards > rejects workspace symlinks that escape the worktree | Skip scoped packages in the workspace link check | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^isolation guards > rejects workspace symlinks that escape the worktree$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| service-relative-import | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (service-reach) relative import service module is production-reachable | Ignore `from . import x` when building the production graph | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(service-reach\\) relative import service module is production-reachable$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| sigint-no-handler | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (h) SIGINT during a row leaves checkout and worktrees clean | Remove the SIGINT cleanup handler | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(h\\) SIGINT during a row leaves checkout and worktrees clean$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| skipped-target-executed | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (d) row pointing at skipped test is rejected on baseline | Treat a skipped target as executed | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(d\\) row pointing at skipped test is rejected on baseline$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| stays-green-accepted | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (b) noop patch stays green fails naming the row | Remove the stays-green guard | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(b\\) noop patch stays green fails naming the row$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| test-only-target-reachable | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (m) revert patch on test-only helper is rejected as unreachable | Disable the production reach check | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(m\\) revert patch on test-only helper is rejected as unreachable$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| tests-dir-not-test-path | scripts/revert-proof.test.ts :: patchTouchesTestFiles > flags tests paths | Stop treating tests/ as a test path | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^patchTouchesTestFiles > flags tests paths$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| timeout-sec-unchecked | scripts/revert-proof.test.ts :: revert-proof-lib guards > (timeoutSec) rejects invalid timeoutSec | Drop timeoutSec validation | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof-lib guards > \\(timeoutSec\\) rejects invalid timeoutSec$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| touch-test-accepted | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (test-touch) patch touching test files is rejected | Disable production-only patch validation | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(test-touch\\) patch touching test files is rejected$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| two-match-accepted | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (filter-two) filter matching two tests is rejected | Drop the multiple-match rejection | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(filter-two\\) filter matching two tests is rejected$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| type-error-accepted | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (vitest-typeerror) TypeError patched run is rejected as build break | Classify every vitest failure as assertion red | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(vitest-typeerror\\) TypeError patched run is rejected as build break$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| valid-revert-not-applied | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (a) correct revert row produces red output and exit 0 | Skip applying the revert patch | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(a\\) correct revert row produces red output and exit 0$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| web-project-as-scripts | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (w) web project row uses web vitest config and runs exactly one test | Run web/ rows with the scripts vitest config | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(w\\) web project row uses web vitest config and runs exactly one test$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |
| wrong-outer-ctx-no-check | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (c3) patch with wrong outer context is rejected by git apply --check | Skip git apply --check before applying | web/node_modules/.bin/vitest run --config scripts/revert-proof-vitest-overlay.mjs -t "^revert-proof runner \\(fixture repo\\) > \\(c3\\) patch with wrong outer context is rejected by git apply --check$" --reporter=json --outputFile.json=<tmp> -- scripts/revert-proof.test.ts | RED (expected) |

### allow-type-error-truthy

```
AssertionError: expected true to be false // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### bad-patch-reject-fallback

```
AssertionError: expected 'row bad-patch: git apply failed: Chec…' to be 'row bad-patch: git apply --check fail…' // Object.is equality
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

### build-break-not-detected

```
AssertionError: expected 'row build-break: patched test selecti…' to be 'row build-break: patch breaks build (…' // Object.is equality
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

### describe-gt-fullname

```
AssertionError: expected 1 to be +0 // Object.is equality
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

### editable-python-unchecked

```
AssertionError: expected undefined to be 'editable Python package rpfixture res…' // Object.is equality
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

### escape-dot-dropped

```
AssertionError: expected '^widget \(beta\) > talkers\[\].failed$' to be '^widget \(beta\) > talkers\[\]\.faile…' // Object.is equality
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

### expect-red-swapped

```
AssertionError: expected 1 to be +0 // Object.is equality
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

### fullname-selection-leaf

```
AssertionError: expected 'returns one' to be 'widget & alpha > returns one' // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### green-class-dropped

```
AssertionError: expected 'build break' to be 'green' // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### hang-timeout-ignored

```
AssertionError: expected 'row hang: baseline test selection fai…' to be 'row hang: baseline timed out' // Object.is equality
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

### json-multi-fullname

```
AssertionError: expected false to be true // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### main-checkout-links-unchecked

```
AssertionError: expected undefined to be 'workspace link <root>/node_modules/es…' // Object.is equality
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

### meta-spoof-accepted

```
AssertionError: expected +0 to be 1 // Object.is equality
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

### multi-file-no-filter

```
AssertionError: row multi-file: baseline test selection failed (other tests not skipped; never a pass)
--- baseline output ---
JSON report written to <tmp>
| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| multi-file | | | | **ERROR: row multi-file: baseline test selection failed (other tests not skipped; never a pass) --- baseline output --- JSON report written to <tmp>** |

: expected 1 to be +0 // Object.is equality
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

### no-match-accepted

```
AssertionError: expected 'row no-match: baseline ran 0 tests (s…' to be 'row no-match: baseline test selection…' // Object.is equality
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

### phantom-leaf-leaf-match

```
AssertionError: expected 'row phantom-leaf: baseline test selec…' to be 'row phantom-leaf: baseline test selec…' // Object.is equality
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

### pr-number-unchecked

```
AssertionError: expected undefined to be 'invalid PR number: ../..' // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### prod-reached-unreachable

```
AssertionError: expected 1 to be +0 // Object.is equality
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

### py-editable-main-cwd

```
AssertionError: expected 1 to be +0 // Object.is equality
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

### py-raise-accepted

```
AssertionError: expected 'row py-raise: red value mismatch (exp…' to be 'row py-raise: patch breaks build or p…' // Object.is equality
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

### pytest-and-split

```
AssertionError: expected 1 to be +0 // Object.is equality
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

### pytest-brackets-stripped

```
AssertionError: expected 1 to be +0 // Object.is equality
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

### pytest-error-unknown

```
AssertionError: expected 'unknown' to be 'build break' // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### pytest-json-collection-clean

```
AssertionError: expected false to be true // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### pytest-json-skip-dropped

```
AssertionError: expected 'other tests not skipped' to be 'target skipped' // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### pytest-node-id-stripped

```
AssertionError: expected 'tests/test_selection.py::test_bracket…' to be 'tests/test_selection.py::test_bracket…' // Object.is equality
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

### pytest-probe-error-accepted

```
AssertionError: expected 'assertion' to be 'build break' // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### pytest-uses-k

```
AssertionError: expected true to be false // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### python-env-no-pythonpath

```
AssertionError: expected '' to be '/wt' // Object.is equality
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

### python-module-unchecked

```
AssertionError: expected undefined to be 'invalid pythonModule: os;print("x")#' // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### reach-exempt-ignored

```
AssertionError: expected 'row reach-exempt-touch: revert target…' to be 'row reach-exempt-touch: test stayed G…' // Object.is equality
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
AssertionError: expected +0 to be 1 // Object.is equality
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

### regex-title-unescaped

```
AssertionError: expected 1 to be +0 // Object.is equality
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

### scoped-links-unchecked

```
AssertionError: expected undefined to be 'workspace link <root>/node_modules/@s…' // Object.is equality
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

### service-relative-import

```
AssertionError: expected 1 to be +0 // Object.is equality
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

### sigint-no-handler

```
AssertionError: expected true to be false // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
```

### skipped-target-executed

```
AssertionError: expected 'row skipped-target: baseline ran 0 te…' to be 'row skipped-target: baseline test sel…' // Object.is equality
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

### stays-green-accepted

```
AssertionError: expected 'row stays-green: red value mismatch (…' to be 'row stays-green: test stayed GREEN af…' // Object.is equality
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

### test-only-target-reachable

```
AssertionError: expected +0 to be 1 // Object.is equality
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

### tests-dir-not-test-path

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

### timeout-sec-unchecked

```
AssertionError: expected undefined to be 'row x: timeoutSec must be a positive …' // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### touch-test-accepted

```
AssertionError: expected 'row touch-test: red value mismatch (e…' to be 'row touch-test: patch touches test fi…' // Object.is equality
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

### two-match-accepted

```
AssertionError: expected +0 to be 1 // Object.is equality
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

### type-error-accepted

```
AssertionError: expected 'row type-error: red value mismatch (e…' to be 'row type-error: patched test failed b…' // Object.is equality
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

### valid-revert-not-applied

```
AssertionError: expected 1 to be +0 // Object.is equality
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

### web-project-as-scripts

```
AssertionError: expected 1 to be +0 // Object.is equality
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

### wrong-outer-ctx-no-check

```
AssertionError: expected 'row wrong-outer-ctx: git apply failed…' to be 'row wrong-outer-ctx: git apply --chec…' // Object.is equality
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
