# Revert rows — PR #137

| Field | Value |
|-------|-------|
| `proven_at` | `c4bcc20983ff55d47b76cf5187f9ff0ecb381141` |
| `tree` | `c4bcc20983ff55d47b76cf5187f9ff0ecb381141` |

Three pytest revert rows (`origin-userinfo`, `origin-path-suffix`, `origin-null-no-token`).

**Dead-code proof (not a revert-proof row):** restoring `return sandbox_null_origin_allowed(request)` in place of `return False` for non-pack `Origin: null` still denies `/api/*`; see `test_sandbox_null_origin_branch_was_dead_on_api_path` (stays green with that one-line restore).
