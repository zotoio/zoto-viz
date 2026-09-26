## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| allow-type-error-truthy | | | | **ERROR: row allow-type-error-truthy: red value mismatch (expected TBD, got AssertionError: expected true to be false // Object.is equality)** |
| bad-patch-reject-fallback | | | | **ERROR: row bad-patch-reject-fallback: red value mismatch (expected TBD, got AssertionError: expected 'row bad-patch: git apply failed: Chec…' to contain 'row bad-patch: git apply --check fail…')** |
| build-break-not-detected | | | | **ERROR: row build-break-not-detected: red value mismatch (expected TBD, got AssertionError: expected 'row build-break: patched test selecti…' to contain 'row build-break: patch breaks build (…')** |
| describe-gt-fullname | | | | **ERROR: row describe-gt-fullname: red value mismatch (expected TBD, got AssertionError: expected 1 to be +0 // Object.is equality)** |
| editable-python-unchecked | | | | **ERROR: row editable-python-unchecked: red value mismatch (expected TBD, got AssertionError: expected [Function] to throw an error)** |
| escape-dot-dropped | | | | **ERROR: row escape-dot-dropped: red value mismatch (expected TBD, got AssertionError: expected '^widget \(beta\) > talkers\[\].failed$' to be '^widget \(beta\) > talkers\[\]\.faile…' // Object.is equality)** |
| expect-red-unbranded | | | | **ERROR: row expect-red-unbranded: red value mismatch (expected TBD, got AssertionError [ERR_ASSERTION]: row expect-red: patched test failed but task.meta.revertProofAssertion is not true (proves nothing; for a real expect() failure, suspect a mismatched chai copy — AssertionError must come from import { chai } from "vitest", not a separate chai package))** |
| fullname-selection-leaf | | | | **ERROR: row fullname-selection-leaf: red value mismatch (expected TBD, got AssertionError: expected 'returns one' to be 'widget & alpha > returns one' // Object.is equality)** |
| green-class-dropped | | | | **ERROR: row green-class-dropped: red value mismatch (expected TBD, got AssertionError: expected 'build break' to be 'green' // Object.is equality)** |
| hand-built-chai-accepted | | | | **ERROR: row hand-built-chai-accepted: red value mismatch (expected TBD, got AssertionError: expected +0 to be 1 // Object.is equality)** |
| hang-timeout-ignored | | | | **ERROR: row hang-timeout-ignored: red value mismatch (expected TBD, got AssertionError: expected 'row hang: baseline test selection fai…' to contain 'row hang: baseline timed out')** |
| json-multi-fullname | | | | **ERROR: row json-multi-fullname: red value mismatch (expected TBD, got AssertionError: expected false to be true // Object.is equality)** |
| main-checkout-links-unchecked | | | | **ERROR: row main-checkout-links-unchecked: red value mismatch (expected TBD, got AssertionError: expected [Function] to throw an error)** |
| meta-spoof-accepted | | | | **ERROR: row meta-spoof-accepted: red value mismatch (expected TBD, got AssertionError: expected +0 to be 1 // Object.is equality)** |
| multi-file-no-filter | | | | **ERROR: row multi-file-no-filter: red value mismatch (expected TBD, got AssertionError: row multi-file: baseline test selection failed (other tests not skipped; never a pass))** |
| no-match-accepted | | | | **ERROR: row no-match-accepted: red value mismatch (expected TBD, got AssertionError: expected 'row no-match: baseline ran 0 tests (s…' to contain 'row no-match: baseline test selection…')** |
| node-assert-red | | | | **ERROR: row node-assert-red: red value mismatch (expected TBD, got AssertionError: row node-assert-red: patched test failed but task.meta.revertProofAssertion is not true (proves nothing; for a real expect() failure, suspect a mismatched chai copy — AssertionError must come from import { chai } from "vitest", not a separate chai package))** |
| phantom-leaf-leaf-match | | | | **ERROR: row phantom-leaf-leaf-match: red value mismatch (expected TBD, got AssertionError: expected 'row phantom-leaf: baseline test selec…' to contain 'row phantom-leaf: baseline test selec…')** |
| plain-object-fake-accepted | | | | **ERROR: row plain-object-fake-accepted: red value mismatch (expected TBD, got AssertionError: expected +0 to be 1 // Object.is equality)** |
| pr-number-unchecked | | | | **ERROR: row pr-number-unchecked: red value mismatch (expected TBD, got AssertionError: expected [Function] to throw an error)** |
| prod-reached-unreachable | | | | **ERROR: row prod-reached-unreachable: red value mismatch (expected TBD, got AssertionError: expected 1 to be +0 // Object.is equality)** |
| proto-borrow-accepted | | | | **ERROR: row proto-borrow-accepted: red value mismatch (expected TBD, got AssertionError: expected +0 to be 1 // Object.is equality)** |
| py-editable-no-pythonpath | | | | **ERROR: row py-editable-no-pythonpath: test stayed GREEN after revert patch (expected failure)** |
| pytest-and-split | | | | **ERROR: row pytest-and-split: red value mismatch (expected TBD, got AssertionError: expected 1 to be +0 // Object.is equality)** |
| pytest-brackets-stripped | | | | **ERROR: row pytest-brackets-stripped: red value mismatch (expected TBD, got AssertionError: expected 1 to be +0 // Object.is equality)** |
| pytest-error-unknown | | | | **ERROR: row pytest-error-unknown: red value mismatch (expected TBD, got AssertionError: expected 'unknown' to be 'build break' // Object.is equality)** |
| pytest-json-collection-clean | | | | **ERROR: row pytest-json-collection-clean: red value mismatch (expected TBD, got AssertionError: expected false to be true // Object.is equality)** |
| pytest-json-skip-dropped | | | | **ERROR: row pytest-json-skip-dropped: red value mismatch (expected TBD, got AssertionError: expected 'other tests not skipped' to be 'target skipped' // Object.is equality)** |
| pytest-node-id-stripped | | | | **ERROR: row pytest-node-id-stripped: red value mismatch (expected TBD, got AssertionError: expected 'tests/test_selection.py::test_bracket…' to be 'tests/test_selection.py::test_bracket…' // Object.is equality)** |
| pytest-probe-error-accepted | | | | **ERROR: row pytest-probe-error-accepted: red value mismatch (expected TBD, got AssertionError: expected 'assertion' to be 'build break' // Object.is equality)** |
| pytest-uses-k | | | | **ERROR: row pytest-uses-k: red value mismatch (expected TBD, got AssertionError: expected true to be false // Object.is equality)** |
| python-env-no-pythonpath | | | | **ERROR: row python-env-no-pythonpath: red value mismatch (expected TBD, got AssertionError: expected '' to be '/wt' // Object.is equality)** |
| python-module-unchecked | | | | **ERROR: row python-module-unchecked: red value mismatch (expected TBD, got AssertionError: expected [Function] to throw an error)** |
| reach-exempt-ignored | | | | **ERROR: row reach-exempt-ignored: red value mismatch (expected TBD, got AssertionError: expected 'row reach-exempt-touch: revert target…' to contain 'row reach-exempt-touch: test stayed G…')** |
| red-not-compared | | | | **ERROR: row red-not-compared: red value mismatch (expected TBD, got AssertionError: expected +0 to be 1 // Object.is equality)** |
| regex-title-unescaped | | | | **ERROR: row regex-title-unescaped: red value mismatch (expected TBD, got AssertionError: expected 1 to be +0 // Object.is equality)** |
| scoped-links-unchecked | | | | **ERROR: row scoped-links-unchecked: red value mismatch (expected TBD, got AssertionError: expected [Function] to throw an error)** |
| service-relative-import | | | | **ERROR: row service-relative-import: red value mismatch (expected TBD, got AssertionError: expected 1 to be +0 // Object.is equality)** |
| sigint-no-handler | | | | **ERROR: row sigint-no-handler: red value mismatch (expected TBD, got AssertionError: expected true to be false // Object.is equality)** |
| skipped-target-executed | | | | **ERROR: row skipped-target-executed: red value mismatch (expected TBD, got AssertionError: expected 'row skipped-target: baseline ran 0 te…' to contain 'row skipped-target: baseline test sel…')** |
| stays-green-accepted | | | | **ERROR: row stays-green-accepted: red value mismatch (expected TBD, got AssertionError: expected 'row stays-green: red value mismatch (…' to contain 'row stays-green: test stayed GREEN af…')** |
| test-only-target-reachable | | | | **ERROR: row test-only-target-reachable: red value mismatch (expected TBD, got AssertionError: expected +0 to be 1 // Object.is equality)** |
| tests-dir-not-test-path | | | | **ERROR: row tests-dir-not-test-path: red value mismatch (expected TBD, got AssertionError: expected false to be true // Object.is equality)** |
| timeout-sec-unchecked | | | | **ERROR: row timeout-sec-unchecked: red value mismatch (expected TBD, got AssertionError: expected [Function] to throw an error)** |
| touch-test-accepted | | | | **ERROR: row touch-test-accepted: red value mismatch (expected TBD, got AssertionError: expected 'row touch-test: git apply --check fai…' to contain 'row touch-test: patch touches test fi…')** |
| two-match-accepted | | | | **ERROR: row two-match-accepted: red value mismatch (expected TBD, got AssertionError: expected +0 to be 1 // Object.is equality)** |
| type-error-accepted | | | | **ERROR: row type-error-accepted: red value mismatch (expected TBD, got AssertionError: expected +0 to be 1 // Object.is equality)** |
| valid-revert-not-applied | | | | **ERROR: row valid-revert-not-applied: red value mismatch (expected TBD, got AssertionError: expected 1 to be +0 // Object.is equality)** |
| web-project-as-scripts | | | | **ERROR: row web-project-as-scripts: red value mismatch (expected TBD, got AssertionError: expected 1 to be +0 // Object.is equality)** |
| wrong-outer-ctx-no-check | | | | **ERROR: row wrong-outer-ctx-no-check: red value mismatch (expected TBD, got AssertionError: expected 'row wrong-outer-ctx: git apply failed…' to contain 'row wrong-outer-ctx: git apply --chec…')** |
