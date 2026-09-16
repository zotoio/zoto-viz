# Subtask 10 — Unified Plugin Zips — live status

<!-- status:metadata:start -->
| Key | Value |
|-----|-------|
| schema_version | 1 |
| subtask_id | 10 |
| feature | Unified Plugin Zips |
| assigned_agent | generalPurpose |
| model | composer-2.5-fast |
| token_budget | 200000 |
| state | completed |
| started_at | 2026-09-15T08:46:20.431Z |
| last_heartbeat | 2026-09-15T09:35:24.015Z |
| completed_at | 2026-09-15T09:35:24.015Z |
| git_sha |  |
| agent_session_id |  |
<!-- status:metadata:end -->

<!-- status:checklist:start -->
- [x] **D01** — Docs rewrite:
- [x] **D02** — **Retire the `ZOTO_VIZ_LEGACY_PLUGINS` opt-in.** After one green
- [x] **D03** — Delete `service/agent_plugins.py`. If any helper still lives there, (`pytest.ini`)
- [x] **D04** — **Delete `tests/test_agent_plugins.py`.** The file imports
- [x] **D05** — Delete the old schemas if subtask 01 left shims:
- [x] **D06** — Remove or update any lingering references to
- [x] **D07** — Full-suite verification (this is the wrap-up phase):
- [x] **D08** — Run `pnpm -w lint` (or the closest equivalent) and address anything
- [x] **D09** — Update the spec's `Execution Notes` in the index with a short
<!-- status:checklist:end -->

<!-- status:artifacts:start -->
- **modified** `docs/plugins.md` — unified
- **modified** `docs/plugins-ts.md` — frontend
- **modified** `docs/api.md` — catalog
- **modified** `docs/install.md` — ZOTO_VIZ_REPO_ROOT
- **modified** `docs/agent.md` — draft
- **modified** `docs/contributing.md` — pack
- **modified** `docs/systemd.md` — zoto-viz.py
- **modified** `docs/.vitepress/config.ts` — sidebar
- **modified** `README.md` — retired
- **modified** `schema/plugin-zip-contract.md` — drop
- **modified** `service/mcp.py` — removed
- **modified** `service/monitor.py` — dropped
- **modified** `service/plugin_migration.py` — removed
- **deleted** `service/agent_plugins.py` — legacy
- **deleted** `tests/test_agent_plugins.py` — surviving
- **modified** `tests/test_plugins.py` — ported
- **modified** `tests/test_plugin_cli.py` — missing
- **modified** `tests/test_mcp.py` — catalog-only
- **modified** `tests/test_plugin_migration.py` — dropped
- **modified** `tests/test_plugin_schema.py` — dropped
- **deleted** `schema/view-plugin.schema.json` — shim
- **deleted** `schema/agent-plugin.schema.json` — shim
- **modified** `schema/plugin.schema.json` — dropped
- **modified** `service/paths.py` — docs
- **modified** `service/plugin_zip.py` — zlib
- **modified** `service/hooks.py` — user-dir
- **modified** `service/plugins.py` — seed
- **modified** `web/src/core/modes.ts` — catalog
- **modified** `plugins/src/air-ssid/visualisation.yml` — install
- **modified** `plugins/air-ssid.zip` — repacked
- **modified** `web/src/ui/feed.test.ts` — TrafficMsg.summary
- **modified** `specs/20260915-unified-plugin-zips/spec-unified-plugin-zips-20260915.md` — Execution
- **modified** `specs/20260915-unified-plugin-zips/subtask-10-unified-plugin-zips-docs-and-cleanup-20260915.md` — subtask
- **modified** `pytest.ini` — dropped service.agent_plugins from --cov= and coverage:run source
- **modified** `docs/plugins-ts.md` — module.js not HTTP 403; consent is UI/sandbox
- **modified** `docs/api.md` — drop module.js 403; keep GLSL 403
<!-- status:artifacts:end -->

<!-- status:errors:start -->
_None._
<!-- status:errors:end -->

<!-- status:notes:start -->
Fix-round (quality-audit / module.js 403 overclaim): docs/plugins-ts.md claimed GET /api/plugins/<id>/module.js 403s if the plugin needs review and is not consented. service/plugins.py api_module does not check consent; it always serves the compiled bundle (404 only if missing). Consent for frontend is the UI/sandbox gate (Settings → Agent allow TypeScript plugins + source-review before loadTsPlugin fetches and PluginSandbox inlines). docs/api.md table repeated the same module.js-403 claim; corrected to 404-if-missing and UI/sandbox consent. docs/plugins.md did not repeat it. GLSL remains accurate: GET /api/plugins/{id}/sky/fragment.glsl 403s without consent (api_sky). Targeted grep of docs/ for module.js + 403; no full suite. token_budget 200000.
Prior fix-round (judge Partial / D03): dropped service.agent_plugins from pytest.ini --cov= addopts and [coverage:run] source.
What's changed (initial round): unified docs; retired ZOTO_VIZ_LEGACY_PLUGINS; deleted service/agent_plugins.py, tests/test_agent_plugins.py, and view/agent schema shims.
Tests: pytest 201 passed; vitest 140 passed (35 files) — prior wrap-up; this round docs-only.
Follow-ups: vitest logs ECONNREFUSED 127.0.0.1:3000 twice but all tests pass (pre-existing noise). ruff check service/monitor.py still reports pre-existing E402/E741/E702/F841 (not a plugin regression).

<!-- status:notes:end -->
