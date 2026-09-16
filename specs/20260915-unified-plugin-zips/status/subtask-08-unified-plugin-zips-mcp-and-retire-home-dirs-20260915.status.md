# Subtask 08 — Unified Plugin Zips — live status

<!-- status:metadata:start -->
| Key | Value |
|-----|-------|
| schema_version | 1 |
| subtask_id | 08 |
| feature | Unified Plugin Zips |
| assigned_agent | generalPurpose |
| model | composer-2.5-fast |
| token_budget | 200000 |
| state | completed |
| started_at | 2026-09-15T08:29:40.509Z |
| last_heartbeat | 2026-09-15T09:36:02.051Z |
| completed_at | 2026-09-15T09:36:02.051Z |
| git_sha |  |
| agent_session_id |  |
<!-- status:metadata:end -->

<!-- status:checklist:start -->
- [x] **D01** — Update `service/mcp.py`: (`service/mcp.py`)
- [x] **D02** — Delete the mirroring logic that copies from (`service/mcp.py`)
- [x] **D03** — Stop seeding `~/.zoto-viz/plugins/` from `examples/plugins/`. The (`service/plugin_migration.py`)
- [x] **D04** — Confirm subtask 03 fully retired `zoto-viz.py plugin install` (and (`tests/test_mcp.py`)
- [x] **D05** — **First-startup migration** (owns the plan in the spec index's (`service/plugin_migration.py`)
- [x] **D06** — **Rollback flag `ZOTO_VIZ_LEGACY_PLUGINS`**: when set to `1`, (`service/mcp.py`)
- [x] **D07** — Update the agent-facing "draft a plugin" flow. Today (`service/agent.py`)
- [x] **D08** — Tests: (`tests/test_mcp.py`)
- [x] **F01** — Update agent.py SYSTEM draft prompt to unified plugin.yml files tree (`service/agent.py`)
- [x] **F02** — Fail closed when git is missing or git status fails in dirty_tree_paths (`service/plugin_migration.py`)
<!-- status:checklist:end -->

<!-- status:artifacts:start -->
- **modified** `service/mcp.py` — install_plugin_zip writes plugins/<id>.zip with loopback dirty-tree overwrite consent guards; no git add
- **created** `service/plugin_migration.py` — home-plugin migration, dirty-tree check, legacy seed from plugins/src
- **modified** `service/agent.py` — api_draft_plugin accepts {files,install} and writes plugins/src/<id>/
- **modified** `service/monitor.py` — migrate on startup; agent-plugins route behind ZOTO_VIZ_LEGACY_PLUGINS
- **modified** `service/agent_plugins.py` — top-of-file comment; kept behind legacy flag; mirror only when flag is on
- **modified** `web/src/ui/agent.ts` — draft POST sends files.plugin.yml
- **created** `tests/test_mcp.py` — catalog write, overwrite, consent-required, dirty-tree, loopback
- **created** `tests/test_plugin_migration.py` — copy, skip-if-present, no auto-commit, legacy seed from src
- **modified** `tests/test_agent.py` — draft-plugin new I/O writes plugins/src/<id>/
- **modified** `tests/test_agent_plugins.py` — legacy MCP tools + cli_zip_deprecated
- **modified** `service/agent.py` — SYSTEM drafts plugin.yml plus optional visualisation.yml frontend backend datasource sky
- **modified** `tests/test_agent.py` — assert SYSTEM uses unified files-tree wording
- **modified** `service/plugin_migration.py` — dirty_tree_paths fails closed on git missing or git status failure
- **modified** `tests/test_plugin_migration.py` — targeted tests for git unavailable fail-closed
- **modified** `tests/test_mcp.py` — MCP refuses write when git unavailable unless force
<!-- status:artifacts:end -->

<!-- status:errors:start -->
_None._
<!-- status:errors:end -->

<!-- status:notes:start -->
Fix-round (quality-audit fix_list): SYSTEM now drafts a unified files tree
(plugin.yml + optional visualisation.yml / frontend / backend / datasource /
sky) instead of the retired view-plugin schema / runtime: typescript.
dirty_tree_paths() fails closed on OSError (git missing) and git status
nonzero — returns git:unavailable so install_plugin_zip refuses unless force.
token_budget 200000.
Tests: .venv/bin/python3 -m pytest tests/test_agent.py
tests/test_plugin_migration.py tests/test_mcp.py -q -o addopts= (42 passed).

Original landing: install_plugin_zip writes plugins/<id>.zip + unpacks
plugins/.runtime/<id>/ (loopback Host, dirty-tree unless force, overwrite
only when sha256 differs, never git add/commit). Consent-required uses
plugins.consented_for hashes {frontend,backend,collector,shader} after unpack.
Default catalog is plugins/*.zip; plugins.seed() stays a no-op. First-startup
migration copies unknown home plugins into plugins/src/<id>/. ZOTO_VIZ_LEGACY_PLUGINS=1
re-registers legacy MCP tools. api_draft_plugin accepts {files, install}.
plugin install leftover docs are subtask 10.
<!-- status:notes:end -->
