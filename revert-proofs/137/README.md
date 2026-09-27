# Revert rows — PR #137

| Field | Value |
|-------|-------|
| `proven_at` | `8d7a43fab3f0e648ccc8647f0c52db37749845ba` |
| `tree` | `8d7a43fab3f0e648ccc8647f0c52db37749845ba` |

Five pytest revert rows (`origin-userinfo`, `origin-path-suffix`, `origin-127-0-0-2-default`, `origin-127-0-0-2-insecure-lan`, `origin-null-no-token`).

**Dead-code proof (not a revert-proof row):** restoring `return sandbox_null_origin_allowed(request)` in place of `return False` for non-pack `Origin: null` still denies `/api/*`; see `test_sandbox_null_origin_branch_was_dead_on_api_path` (stays green with that one-line restore).
