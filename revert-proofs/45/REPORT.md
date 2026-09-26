## Revert proof (manual `3386b56` verification)

| row | red excerpt | green |
| --- | --- | --- |
| `api-file-list-at-limit` | tests/test_pack_boundary_secure.py:107: AssertionError | pass |
| `ci-test-needs-extra-unknown` | tests/test_ci_test_needs.py:27: AssertionError | pass |
| `ci-test-needs-missing-job` | tests/test_ci_test_needs.py:21: AssertionError | pass |
| `ci-test-needs-real-workflow` | E       AssertionError: assert 1 == 0 | pass |
| `ci-test-needs-valid-fixture` | E       AssertionError: assert ['broken'] == [] | pass |
| `dogfood-count-gate-ok` | AssertionError: expected false to be true // Object.is equality | pass |
| `flow-work-scales-4-4x-gate` | AssertionError: expected true to be false // Object.is equality | pass |
| `headline-decimation-eligibility-before-cap` | AssertionError: expected 64 to be greater than 64 | pass |
| `incomplete-pull-files-vs-changed-files` | tests/test_pack_pr_boundary.py:388: AssertionError | pass |
| `merge-workflow-label-event-host-reviewed` | tests/test_pack_pr_boundary.py:369: AssertionError | pass |
| `multi-pack-host-infra-when-reviewed` | tests/test_pack_pr_boundary.py:160: AssertionError | pass |
| `multi-pack-plugins-only-passes` | tests/test_pack_pr_boundary.py:149: AssertionError | pass |
| `naive-triple-talker-scan-flow-cap` | AssertionError: expected true to be false // Object.is equality | pass |
| `non-array-pull-files-page` | tests/test_pack_pr_boundary.py:383: AssertionError | pass |
| `output-caps-decimation-fat-lan` | AssertionError: expected 1881 to be less than or equal to 1 | pass |
| `over-3000-changed-files-rejection` | tests/test_pack_pr_boundary.py:395: AssertionError | pass |
| `pack-pr-editing-workflow-yaml-host-infra` | tests/test_pack_pr_boundary.py:354: AssertionError | pass |
| `pack-pr-github-workflow-host-infra` | tests/test_pack_pr_boundary.py:125: AssertionError | pass |
| `pack-pr-scripts-change-host-infra` | tests/test_pack_pr_boundary.py:137: AssertionError | pass |
| `pr-head-file-size-cap` | tests/test_pack_boundary_secure.py:100: AssertionError | pass |
| `pr-head-symlink-rejected` | tests/test_pack_boundary_secure.py:61: AssertionError | pass |
| `pull-files-fixture-host-script` | tests/test_pack_pr_boundary.py:342: AssertionError | pass |
| `unsafe-path-control-chars-rejected` | E       AssertionError: assert None is not None | pass |
| `vitest-stripped-child-build` | AssertionError: expected [Function] to not throw an error but 'Error: Command failed: bash /workspac…' was thrown | pass |
| `weakened-pr-checker-on-disk-still-fails` | tests/test_pack_boundary_secure.py:46: AssertionError | pass |
| `work-budget-600-frame-host-clamp` | AssertionError: expected 99 to be 4 // Object.is equality | pass |
| `work-budget-catalog-clamp-not-block` | tests/test_manifest_work_budget.py:86: AssertionError | pass |
| `work-budget-install-ten-x-block` | E       AssertionError: assert False is True | pass |
| `work-budget-lowered-ceiling-ui-note` | AssertionError: expected 'marble-run · v1 · graph / protocols' to be 'marble-run · v1 · graph / protocols. …' // Object.is equality | pass |
| `work-budget-pack-policy-ignored` | E       AssertionError: assert False is True | pass |
| `work-budget-policy-parity-hardcode-ts` | AssertionError: expected false to be true // Object.is equality | pass |
| `work-budget-policy-parity-hardcode` | tests/test_manifest_work_budget.py:114: AssertionError | pass |
| `workflow-command-injection-escaped` | E       AssertionError: assert False | pass |
