# Revert rows — PR #137

| Field | Value |
|-------|-------|
| `proven_at` | `957785ea328adfcd9ae7b6b0ee2d01827073ddc7` |
| `tree` | `957785ea328adfcd9ae7b6b0ee2d01827073ddc7` |

Five pytest revert rows (`origin-userinfo`, `origin-path-suffix`, `origin-127-0-0-2-default`, `origin-127-0-0-2-insecure-lan`, `origin-null-no-token`).

**Dead-code proof (not a revert-proof row):** restoring `return sandbox_null_origin_allowed(request)` in place of `return False` for non-pack `Origin: null` still denies `/api/*`; see `test_sandbox_null_origin_branch_was_dead_on_api_path` (stays green with that one-line restore).
