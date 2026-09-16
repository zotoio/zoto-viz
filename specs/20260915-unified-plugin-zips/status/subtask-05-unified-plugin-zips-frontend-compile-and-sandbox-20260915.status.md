# Subtask 05 — Unified Plugin Zips — live status

<!-- status:metadata:start -->
| Key | Value |
|-----|-------|
| schema_version | 1 |
| subtask_id | 05 |
| feature | Unified Plugin Zips |
| assigned_agent | generalPurpose |
| model | composer-2.5-fast |
| token_budget | 200000 |
| state | completed |
| started_at | 2026-09-15T07:39:09.925Z |
| last_heartbeat | 2026-09-15T07:58:00.850Z |
| completed_at | 2026-09-15T07:46:44.776Z |
| git_sha |  |
| agent_session_id |  |
<!-- status:metadata:end -->

<!-- status:checklist:start -->
- [x] **D01** — Update the plugin frontend host in `web/src/plugins/plugin.ts` (`web/src/plugins/plugin.ts`)
- [x] **D02** — Update the backend HTTP handler that serves plugin modules to point (`service/plugins.py`)
- [x] **D03** — Add `MIME` + `Cache-Control` headers consistent with the existing (`service/plugins.py`)
- [x] **D04** — Extend the `/plugins` payload to include: (`service/plugins.py`)
- [x] **D05** — Update `web/src/plugins/plugin.test.ts` **and** (`web/src/plugins/plugin.test.ts`)
- [x] **D06** — Add or extend a backend test (`tests/test_plugin_frontend.py` if new (`tests/test_plugin_frontend.py`)
<!-- status:checklist:end -->

<!-- status:artifacts:start -->
- **modified** `web/src/plugins/plugin.ts` — load /plugins/<id>/module.js via attachPluginFrontend
- **modified** `web/src/plugins/host.ts` — PluginSandbox.loadModule fetch + iframe sandbox unchanged
- **modified** `service/plugins.py` — compile plugins/.runtime/<id>/frontend/ with sha256+mtime cache
- **modified** `web/src/plugins/plugin-visualisation.ts` — toPluginView copies optional-part booleans
- **modified** `web/src/plugins/plugin.test.ts` — payload shape + attachPluginFrontend fetch mock
- **modified** `web/src/plugins/host.test.ts` — loadModule iframe-load path
- **created** `tests/test_plugin_frontend.py` — compile + cache + yaml-only payload
- **modified** `web/src/app/main.ts` — loadTsPlugin uses pluginHasFrontend + attachPluginFrontend
- **modified** `web/src/plugins/plugin-ui.ts` — source-review copy treats has_frontend like typescript
<!-- status:artifacts:end -->

<!-- status:errors:start -->
_None._
<!-- status:errors:end -->

<!-- status:notes:start -->
Compiled plugins/.runtime/<id>/frontend/ (or legacy runtime:typescript entry)
with esbuild; GET /api/plugins/<id>/module.js cache-keyed on zip sha256 +
entry mtime. Payload adds has_frontend, frontend.entry, capabilities,
has_sky, has_sky_shader, has_backend, has_datasource. Sandbox iframe +
capability allowlist unchanged. Sky shader serving left to subtask 07.
Tests: vitest plugin.test.ts + host.test.ts (12 passed); pytest
test_plugin_frontend.py + test_plugins.py (16 passed).
<!-- status:notes:end -->
