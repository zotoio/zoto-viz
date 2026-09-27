## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| brand-expect | | | | **ERROR: row brand-expect: patched test failed but task.meta.revertProofAssertion is not true (proves nothing; for a real expect() failure, suspect a mismatched chai copy — AssertionError must come from import { chai } from "vitest", not a separate chai package)** |
| brand-shared-instance | | | | **ERROR: row brand-shared-instance: patched test failed but task.meta.revertProofAssertion is not true (proves nothing; for a real expect() failure, suspect a mismatched chai copy — AssertionError must come from import { chai } from "vitest", not a separate chai package)** |
| brand-soft-fail | | | | **ERROR: row brand-soft-fail: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":false,"expected":true})** |
| brand-soft-pass-then-typeerror | | | | **ERROR: row brand-soft-pass-then-typeerror: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":true,"expected":false})** |
| brand-soft-then-typeerror | | | | **ERROR: row brand-soft-then-typeerror: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":false,"expected":true})** |
| brand-typeerror | | | | **ERROR: row brand-typeerror: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":true,"expected":false})** |
| classify-accepts-meta | | | | **ERROR: row classify-accepts-meta: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":"build break","expected":"assertion"})** |
| classify-green | | | | **ERROR: row classify-green: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":"build break","expected":"green"})** |
| classify-rejects-no-meta | | | | **ERROR: row classify-rejects-no-meta: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":"assertion","expected":"build break"})** |
| classify-rejects-plain-meta | | | | **ERROR: row classify-rejects-plain-meta: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":"assertion","expected":"build break"})** |
| production-only-guard | | | | **ERROR: row production-only-guard: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":null,"expected":"row dogfood: patch touches test files (only production reverts allowed)"})** |
| production-reach-guard | | | | **ERROR: row production-reach-guard: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":null,"expected":"row dogfood: revert target unreachable from production: web/src/test-only-helper.ts"})** |
| pytest-accepts-meta | | | | **ERROR: row pytest-accepts-meta: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":"build break","expected":"assertion"})** |
| pytest-assert-vs-raise | | | | **ERROR: row pytest-assert-vs-raise: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":"assertion","expected":"build break"})** |
| pytest-collection-error | | | | **ERROR: row pytest-collection-error: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":false,"expected":true})** |
| pytest-plugin-assert | | | | **ERROR: row pytest-plugin-assert: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":null,"expected":{"nodeid":"test_case.py::test_case","outcome":"failed","revertProofAssertion":true,"revertProofRed":{"assert":"assert answer == 2"}}})** |
| pytest-plugin-raise | | | | **ERROR: row pytest-plugin-raise: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":{"nodeid":"test_case.py::test_case","outcome":"failed","revertProofAssertion":true,"revertProofRed":{"assert":"raise AssertionError(\"answer == 2\")"}},"expected":{"nodeid":"test_case.py::test_case","outcome":"failed","revertProofAssertion":false,"revertProofRed":null}})** |
| pytest-red-carried | | | | **ERROR: row pytest-red-carried: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":null,"expected":{"assert":"assert answer == 2"}})** |
| pytest-rejects-no-meta | | | | **ERROR: row pytest-rejects-no-meta: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":"assertion","expected":"build break"})** |
| pytest-target-skipped | | | | **ERROR: row pytest-target-skipped: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":"other tests not skipped","expected":"target skipped"})** |
| red-line-dropped | | | | **ERROR: row red-line-dropped: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":null,"expected":"AssertionError: expected 2 to be 1 // Object.is equality"})** |
| red-not-compared | | | | **ERROR: row red-not-compared: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":null,"expected":"row r: red value mismatch (expected {\"actual\":2,\"expected\":1}, got {\"actual\":3,\"expected\":1})"})** |
| red-not-required | | | | **ERROR: row red-not-required: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":null,"expected":"row r: sidecar JSON missing object field \"red\""})** |
| red-pytest-shape | | | | **ERROR: row red-pytest-shape: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":null,"expected":"row r: pytest red must be { assert: \"assert …\" } (rewritten assert source)"})** |
| red-string-accepted | | | | **ERROR: row red-string-accepted: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":"row r: vitest red must be { actual, expected } (structured assertion values)","expected":"row r: sidecar JSON missing object field \"red\""})** |
| red-vitest-shape | | | | **ERROR: row red-vitest-shape: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":null,"expected":"row r: vitest red must be { actual, expected } (structured assertion values)"})** |
| runner-meta-only | | | | **ERROR: row runner-meta-only: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":true,"expected":false})** |
| selection-multiple-matched | | | | **ERROR: row selection-multiple-matched: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":true,"expected":false})** |
| selection-other-executed | | | | **ERROR: row selection-other-executed: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":true,"expected":false})** |
| selection-others-skipped | | | | **ERROR: row selection-others-skipped: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":false,"expected":true})** |
| selection-target-skipped | | | | **ERROR: row selection-target-skipped: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":true,"expected":false})** |
| stays-green-guard | | | | **ERROR: row stays-green-guard: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":null,"expected":"row dogfood: test stayed GREEN after revert patch (expected failure)"})** |
| vitest-fullname-ancestors | | | | **ERROR: row vitest-fullname-ancestors: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":"returns one","expected":"widget > alpha > returns one"})** |
| vitest-red-parsed | | | | **ERROR: row vitest-red-parsed: red value mismatch (expected {"actual":"?","expected":"?"}, got {"actual":null,"expected":{"actual":2,"expected":1}})** |
