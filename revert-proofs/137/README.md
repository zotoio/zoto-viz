# Revert rows — PR #137

| Field | Value |
|-------|-------|
| `proven_at` | `f3919eae0f0fbdf52d7c2062bcdfe78de994f8cf` |
| `tree` | `f3919eae0f0fbdf52d7c2062bcdfe78de994f8cf` |

Three pytest revert rows (`origin-userinfo`, `origin-path-suffix`, `origin-null-no-token`).

**Dead-code proof (not a revert-proof row):** restoring `return sandbox_null_origin_allowed(request)` in place of `return False` for non-pack `Origin: null` still denies `/api/*`; see `test_sandbox_null_origin_branch_was_dead_on_api_path` (stays green with that one-line restore).
