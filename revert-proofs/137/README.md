# Revert rows — PR #137

| Field | Value |
|-------|-------|
| `proven_at` | _(filled at PR head after revert-proof run)_ |
| `tree` | _(filled at PR head after revert-proof run)_ |

Five pytest revert rows (`origin-userinfo`, `origin-path-suffix`, `origin-127-0-0-2-default`, `origin-127-0-0-2-insecure-lan`, `origin-null-no-token`).

**Dead-code proof (not a revert-proof row):** `origin-null-dead-branch.patch` restores `sandbox_null_origin_allowed` in `origin_ok`; `test_sandbox_null_origin_branch_was_dead_on_api_path` stays **green** (patch does not change the deny result).
