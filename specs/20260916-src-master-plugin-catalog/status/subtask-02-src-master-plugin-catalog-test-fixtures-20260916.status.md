# Subtask 02 — Src-Master Plugin Catalog — live status

<!-- status:metadata:start -->
| Key | Value |
|-----|-------|
| schema_version | 1 |
| subtask_id | 02 |
| feature | Src-Master Plugin Catalog |
| assigned_agent | generalPurpose |
| model | composer-2.5-fast |
| token_budget | 200000 |
| state | completed |
| started_at | 2026-09-16 03:34:34.107000+00:00 |
| last_heartbeat | 2026-09-16T03:44:55.551Z |
| completed_at | 2026-09-16T03:44:55.551Z |
| git_sha |  |
| agent_session_id |  |
<!-- status:metadata:end -->

<!-- status:checklist:start -->
- [x] **D01** — Update `tests/test_plugin_frontend.py` so compile/sandbox tests do (`tests/test_plugin_frontend.py`)
- [x] **D02** — Update `tests/test_plugin_sky.py` the same way (`_pack_sky` currently (`tests/test_plugin_sky.py`)
- [x] **D03** — Update `tests/test_plugin_backend.py` the same way. (`tests/test_plugin_backend.py`)
- [x] **D04** — Update `tests/test_plugins.py` (and `tests/test_hooks.py` only if a (`tests/test_plugins.py`)
- [x] **D05** — Do **not** edit `tests/test_plugin_cli.py`, `tests/test_mcp.py`, (`tests/test_plugin_cli.py`)
- [x] **D06** — Targeted pytest on the files this subtask touches passes. (`tests/test_plugin_frontend.py`)
<!-- status:checklist:end -->

<!-- status:artifacts:start -->
- **modified** `tests/test_plugin_frontend.py` — src-only compile plus zip-only runtime compile
- **modified** `tests/test_plugin_sky.py` — src-only sky serve plus zip-only runtime hash bump
- **modified** `tests/test_plugin_backend.py` — src catalog hash plus zip-only unpack hash
- **modified** `tests/test_plugins.py` — zip catalog zip-only and consent src-only
- **modified** `specs/20260916-src-master-plugin-catalog/subtask-02-src-master-plugin-catalog-test-fixtures-20260916.md` — execution notes and checkboxes
<!-- status:artifacts:end -->

<!-- status:errors:start -->
_None._
<!-- status:errors:end -->

<!-- status:notes:start -->
Split src+zip fixtures. Shipped-path tests are src-only; unpack tests pack from a staging tree (no plugins/src). test_hooks.py had no dual fixture and was left untouched. CLI/MCP/migration/agent tests left to 03. Targeted pytest --no-cov: 31 passed. ruff clean. Did not run full suite. Did not commit. token_budget: 200000.
<!-- status:notes:end -->
