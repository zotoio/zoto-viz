# Revert rows — PR #137

| Field | Value |
|-------|-------|
| `proven_at` | `fc092f2cdf570172c50cb4b9a9072de532d4bcfe` |
| `tree` | `fc092f2cdf570172c50cb4b9a9072de532d4bcfe` |

Three pytest revert rows (`origin-userinfo`, `origin-path-suffix`, `origin-null-no-token`).

**Dead-code proof (not a revert-proof row):** restoring `return sandbox_null_origin_allowed(request)` in place of `return False` for non-pack `Origin: null` still denies `/api/*`; see `test_sandbox_null_origin_branch_was_dead_on_api_path` (stays green with that one-line restore).
