## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| production-only-guard | scripts/revert-proof.test.ts -t "rejects patch touching test" | Disable production-only patch validation | web/node_modules/.bin/vitest run scripts/revert-proof.test.ts -t rejects patch touching test | RED (expected) |
| stays-green-guard | scripts/revert-proof.test.ts -t "row whose revert does not break" | Remove stays-green failure guard so noop reverts are accepted | web/node_modules/.bin/vitest run scripts/revert-proof.test.ts -t row whose revert does not break | RED (expected) |

### production-only-guard

```
RUN  v5.0.0 /workspace

 ❯ scripts/revert-proof.test.ts (6 tests | 1 failed | 5 skipped) 466ms
   ❯ revert-proof runner (fixture repo) (5)
     × rejects patch touching test files 465ms

 Test Files  1 failed (1)
      Tests  1 failed | 5 skipped (6)
   Start at  17:56:26
   Duration  583ms (tests 93%, transform 4%, import 2%, worker 1%)


⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  scripts/revert-proof.test.ts > revert-proof runner (fixture repo) > rejects patch touching test files
AssertionError: expected 'git apply -R failed: error: corrupt p…' to match /row touch-test.*test files/i

- Expected:
/row touch-test.*test files/i

+ Received:
"git apply -R failed: error: corrupt patch at line 10

## Revert proof
| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| touch-test | | | | **ERROR: git apply -R failed: error: corrupt patch at line 10 ** |

"

 ❯ scripts/revert-proof.test.ts:173:33
    171|     const r = runRevertProof(root, "99");
    172|     expect(r.status).toBe(1);
    175|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
```

### stays-green-guard

```
RUN  v5.0.0 /workspace

 ❯ scripts/revert-proof.test.ts (6 tests | 1 failed | 5 skipped) 5075ms
   ❯ revert-proof runner (fixture repo) (5)
     × row whose revert does not break the test exits 1 naming the row 5074ms

 Test Files  1 failed (1)
      Tests  1 failed | 5 skipped (6)
   Start at  17:56:28
   Duration  5.19s (tests 99%)


⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  scripts/revert-proof.test.ts > revert-proof runner (fixture repo) > row whose revert does not break the test exits 1 naming the row
AssertionError: expected +0 to be 1 // Object.is equality

- Expected
+ Received

- 1
+ 0

 ❯ scripts/revert-proof.test.ts:158:22
    156|     commitRevertProofs(root);
    157|     const r = runRevertProof(root, "99");
    160|     expectOnlyReportDirty(root);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
```
