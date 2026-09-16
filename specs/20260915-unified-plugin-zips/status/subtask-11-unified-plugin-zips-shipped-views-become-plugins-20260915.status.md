# Subtask 11 — Unified Plugin Zips — live status

<!-- status:metadata:start -->
| Key | Value |
|-----|-------|
| schema_version | 1 |
| subtask_id | 11 |
| feature | Unified Plugin Zips |
| assigned_agent | generalPurpose |
| model | composer-2.5-fast |
| token_budget | 200000 |
| state | completed |
| started_at | 2026-09-15T08:28:34.619Z |
| last_heartbeat | 2026-09-15T08:44:46.241Z |
| completed_at | 2026-09-15T08:35:13.569Z |
| git_sha | f1e50b65f1f18ad0787bea3c763179138777ebc1 |
| agent_session_id |  |
<!-- status:metadata:end -->

<!-- status:checklist:start -->
- [x] **D01** — **Host engines, not menu rows.** Keep the graph-base `ViewMode` (`web/src/core/modes.ts`)
- [x] **D02** — **Default catalog = former shipped views.** After subtask 09's (`tests/test_plugin_catalog.py`)
- [x] **D03** — **Duplicate-id overlay (plugin-on-plugin).** If a later zip shares (`web/src/core/modes.test.ts`)
- [x] **D04** — **Fallbacks.** `modeById` must not hard-code `topology`. (`web/src/core/modes.ts`)
- [x] **D05** — **Consent.** YAML-only catalog views (no `frontend/`, no (`web/src/plugins/plugin.ts`)
- [x] **D06** — **Tests to rewrite** (targeted): (`web/src/core/modes.test.ts`)
<!-- status:checklist:end -->

<!-- status:artifacts:start -->
- **modified** `web/src/core/modes.ts` — catalog-only allModes; GRAPH_BASES+ARCADE_ENGINES wrap targets
- **modified** `web/src/core/modes.test.ts` — catalog-driven menu, overlay, empty-catalog fallbacks
- **modified** `web/src/plugins/plugin.ts` — hostEngine wrap; catalog viewSelectOptions; YAML-only skip consent
- **modified** `web/src/plugins/plugin.test.ts` — plugin-on-plugin overlay; catalog topology menu row
- **modified** `web/src/core/profiles.ts` — default mode from catalog topology plugin
- **modified** `web/src/core/profiles.test.ts` — empty catalog topology string; catalog plugin:topology
- **modified** `web/src/app/main.ts` — keyboard and dream cycle allModes/graphModes
- **modified** `web/src/graph/mosaic.ts` — pane pool from catalog allModes
- **modified** `web/src/graph/scene.ts` — topology host-engine stub for empty catalog
- **modified** `tests/test_plugin_catalog.py` — 14 former MODES ids are menu plugins
<!-- status:artifacts:end -->

<!-- status:errors:start -->
_None._
<!-- status:errors:end -->

<!-- status:notes:start -->
Live menu is catalog-only. Deleted hardcoded MODES from allModes(); GRAPH_BASES + ARCADE_ENGINES stay wrap targets. graphModes() is catalog graph plugins. Keyboard/mosaic/dream cycling iterate allModes()/graphModes(). modeById resolves catalog id or pluginId, then defaultCatalogMode (topology first), then topology host-engine stub (not a menu row). Empty catalog does not throw. YAML-only views skip consent; has_backend/has_datasource join the review path. Profiles keep mode "topology" with an empty catalog and plugin:topology when that zip is loaded.

Tests: cd web && pnpm test -- src/core/modes.test.ts src/plugins/plugin.test.ts src/core/profiles.test.ts (140 passed / 35 files). .venv/bin/python3 -m pytest tests/test_plugin_catalog.py -q -o addopts= (5 passed, including former 14 MODES ids as menu plugins). token_budget 200000.
<!-- status:notes:end -->
