## Revert proof (manual `6a0ed50` verification)

Hand-run: `git apply` one-line patch, anchored single test. Count line proves exactly one test ran.

| row | green | red |
| --- | --- | --- |
| `api-file-list-at-limit` | `1 passed in 0.02s` | tests/test_pack_boundary_secure.py:107: AssertionError · `1 failed in 0.03s` |
| `ci-test-needs-extra-unknown` | `1 passed in 0.06s` | tests/test_ci_test_needs.py:27: AssertionError · `1 failed in 0.02s` |
| `ci-test-needs-missing-job` | `1 passed in 0.02s` | tests/test_ci_test_needs.py:21: AssertionError · `1 failed in 0.02s` |
| `ci-test-needs-real-workflow` | `1 passed in 0.02s` | E       AssertionError: assert 1 == 0 · `1 failed in 0.03s` |
| `ci-test-needs-valid-fixture` | `1 passed in 0.01s` | E       AssertionError: assert ['broken'] == [] · `1 failed in 0.02s` |
| `dogfood-count-gate-ok` | `Tests  1 passed | 18 skipped (19)` | AssertionError: expected false to be true // Object.is equality · `Tests  1 failed | 18 skipped (19)` |
| `flow-work-scales-4-4x-gate` | `Tests  1 passed | 7 skipped (8)` | AssertionError: expected true to be false // Object.is equality · `Tests  1 failed | 7 skipped (8)` |
| `headline-decimation-eligibility-before-cap` | `Tests  1 passed | 7 skipped (8)` | AssertionError: expected 64 to be greater than 64 · `Tests  1 failed | 7 skipped (8)` |
| `incomplete-pull-files-vs-changed-files` | `1 passed in 0.03s` | tests/test_pack_pr_boundary.py:388: AssertionError · `1 failed in 0.04s` |
| `merge-workflow-label-event-host-reviewed` | `1 passed in 0.03s` | tests/test_pack_pr_boundary.py:369: AssertionError · `1 failed in 0.04s` |
| `multi-pack-host-infra-when-reviewed` | `1 passed in 0.03s` | tests/test_pack_pr_boundary.py:160: AssertionError · `1 failed in 0.04s` |
| `multi-pack-plugins-only-passes` | `1 passed in 0.03s` | tests/test_pack_pr_boundary.py:149: AssertionError · `1 failed in 0.04s` |
| `naive-triple-talker-scan-flow-cap` | `Tests  1 passed | 7 skipped (8)` | AssertionError: expected true to be false // Object.is equality · `Tests  1 failed | 7 skipped (8)` |
| `non-array-pull-files-page` | `1 passed in 0.03s` | tests/test_pack_pr_boundary.py:383: AssertionError · `1 failed in 0.04s` |
| `output-caps-decimation-fat-lan` | `Tests  1 passed | 7 skipped (8)` | AssertionError: expected 1881 to be less than or equal to 1 · `Tests  1 failed | 7 skipped (8)` |
| `over-3000-changed-files-rejection` | `1 passed in 0.03s` | tests/test_pack_pr_boundary.py:395: AssertionError · `1 failed in 0.04s` |
| `pack-pr-editing-workflow-yaml-host-infra` | `1 passed in 0.03s` | tests/test_pack_pr_boundary.py:354: AssertionError · `1 failed in 0.04s` |
| `pack-pr-github-workflow-host-infra` | `1 passed in 0.03s` | tests/test_pack_pr_boundary.py:125: AssertionError · `1 failed in 0.04s` |
| `pack-pr-scripts-change-host-infra` | `1 passed in 0.03s` | tests/test_pack_pr_boundary.py:137: AssertionError · `1 failed in 0.04s` |
| `pr-head-file-size-cap` | `1 passed in 0.03s` | tests/test_pack_boundary_secure.py:100: AssertionError · `1 failed in 0.04s` |
| `pr-head-symlink-rejected` | `1 passed in 0.02s` | tests/test_pack_boundary_secure.py:61: AssertionError · `1 failed in 0.03s` |
| `pull-files-fixture-host-script` | `1 passed in 0.03s` | tests/test_pack_pr_boundary.py:342: AssertionError · `1 failed in 0.04s` |
| `unsafe-path-control-chars-rejected` | `1 passed in 0.02s` | E       AssertionError: assert None is not None · `1 failed in 0.03s` |
| `vitest-stripped-child-build` | `Tests  1 passed | 7 skipped (8)` | AssertionError: expected [Function] to not throw an error but 'Error: Command failed: bash /workspac…' was thrown · `Tests  1 failed | 7 skipped (8)` |
| `weakened-pr-checker-on-disk-still-fails` | `1 passed in 0.02s` | tests/test_pack_boundary_secure.py:46: AssertionError · `1 failed in 0.03s` |
| `work-budget-600-frame-host-clamp` | `Tests  1 passed | 6 skipped (7)` | AssertionError: expected 99 to be 4 // Object.is equality · `Tests  1 failed | 6 skipped (7)` |
| `work-budget-catalog-clamp-not-block` | `1 passed in 0.02s` | tests/test_manifest_work_budget.py:86: AssertionError · `1 failed in 0.03s` |
| `work-budget-install-ten-x-block` | `1 passed in 0.02s` | E       AssertionError: assert False is True · `1 failed in 0.02s` |
| `work-budget-lowered-ceiling-ui-note` | `Tests  1 passed | 6 skipped (7)` | AssertionError: expected 'marble-run · v1 · graph / protocols' to be 'marble-run · v1 · graph / protocols. …' // Object.is equality · `Tests  1 failed | 6 skipped (7)` |
| `work-budget-pack-policy-ignored` | `1 passed in 0.02s` | E       AssertionError: assert False is True · `1 failed in 0.03s` |
| `work-budget-policy-parity-hardcode-ts` | `Tests  1 passed | 6 skipped (7)` | AssertionError: expected false to be true // Object.is equality · `Tests  1 failed | 6 skipped (7)` |
| `work-budget-policy-parity-hardcode` | `1 passed in 0.02s` | tests/test_manifest_work_budget.py:114: AssertionError · `1 failed in 0.03s` |
| `workflow-command-injection-escaped` | `1 passed in 0.02s` | E       AssertionError: assert False · `1 failed in 0.03s` |
