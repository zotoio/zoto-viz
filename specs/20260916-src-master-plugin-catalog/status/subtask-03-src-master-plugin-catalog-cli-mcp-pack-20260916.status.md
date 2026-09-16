# Subtask 03 — Src-Master Plugin Catalog — live status

<!-- status:metadata:start -->
| Key | Value |
|-----|-------|
| schema_version | 1 |
| subtask_id | 03 |
| feature | Src-Master Plugin Catalog |
| assigned_agent | generalPurpose |
| model | composer-2.5-fast |
| token_budget | 200000 |
| state | completed |
| started_at | 2026-09-16T03:35:02.574Z |
| last_heartbeat | 2026-09-16T03:45:48.423Z |
| completed_at | 2026-09-16T03:41:01.659Z |
| git_sha |  |
| agent_session_id |  |
<!-- status:metadata:end -->

<!-- status:checklist:start -->
- [x] **D01** — `cli_pack` (`service/plugins.py` / `zoto-viz.py plugin pack`): (`service/plugins.py`)
- [x] **D02** — `.gitignore`: add `dist/` (in addition to subtask 01’s (`.gitignore`)
- [x] **D03** — `cli_add`: if `plugins/src/<id>/plugin.yml` (or `.yaml`) exists, (`service/plugins.py`)
- [x] **D04** — MCP `install_plugin_zip` (`service/mcp.py`): (`service/mcp.py`)
- [x] **D05** — `plugin_migration.dirty_tree_paths`: stop treating (`service/plugin_migration.py`)
- [x] **D06** — `plugin_migration.MIGRATE_HINT` and the console line: src is live; (`service/plugin_migration.py`)
- [x] **D07** — `catalog_ids()` already treats src **or** zip as present; keep that (`tests/test_plugin_migration.py`)
- [x] **D08** — Tests (tmp repo): (`tests/test_plugin_cli.py`)
<!-- status:checklist:end -->

<!-- status:artifacts:start -->
- **modified** `service/plugins.py` — cli_pack defaults to dist/<id>.zip; -o/--output
- **modified** `.gitignore` — add dist/; keep plugins/*.zip
- **modified** `service/plugins.py` — cli_add hard-refuses src ids; --force does not override
- **modified** `service/mcp.py` — install_plugin_zip src refuse even with force
- **modified** `service/plugin_migration.py` — dirty_tree_paths no longer tracks gitignored zips
- **modified** `service/plugin_migration.py` — MIGRATE_HINT src is live; agent pack -o share hint
- **modified** `tests/test_plugin_migration.py` — catalog_ids src or zip; leftover home matching src uncopied
- **modified** `tests/test_plugin_cli.py` — pack dist/-o, add src refuse, MCP/migration/agent tests
- **modified** `service/agent.py` — draft hint src live; pack -o to share
- **modified** `tests/test_mcp.py` — src_owns_id refuse; gitignored zip not dirty
- **modified** `tests/test_agent.py` — hint asserts src live and pack -o
<!-- status:artifacts:end -->

<!-- status:errors:start -->
_None._
<!-- status:errors:end -->

<!-- status:notes:start -->
Pack shares via dist/<id>.zip or -o; add/MCP hard-refuse src ids even with force.
Targeted pytest -o addopts=: 58 passed (test_plugin_cli, test_mcp, test_plugin_migration, test_agent).
Did not rewrite docs. Did not run full suite. Did not commit. token_budget: 200000.

<!-- status:notes:end -->
