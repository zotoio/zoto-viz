# PR #131 — revert-proof case (2) fail-open revert proof

Temporary skip-when-missing replay branch (env `REVERT_PROOF_DEMO_FAIL_OPEN_MISSING_REPLAY=1` on `assertReplayPullHeadTreeKey` + `listRows`) — **not shipped**; used only to capture red/green below.

## RED (fail-open: `--replay` exits 0; test fails)

```
FAIL  scripts/revert-proof.test.ts > ... > (replay-no-record) --replay exits non-zero when proof folder was removed
AssertionError: expected +0 not to be +0 // Object.is equality
```

## GREEN (fail-closed: `--replay` exits non-zero with `no record`)

```
Test Files  1 passed (1)
Tests  1 passed | 52 skipped (53)
```

Full vitest output captured at `/tmp/case2-red.txt` and `/tmp/case2-green.txt` on the agent VM during development.
