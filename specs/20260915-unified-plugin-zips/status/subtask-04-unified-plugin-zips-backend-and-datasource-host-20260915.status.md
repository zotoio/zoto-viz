# Subtask 04 — Unified Plugin Zips — live status

<!-- status:metadata:start -->
| Key | Value |
|-----|-------|
| schema_version | 1 |
| subtask_id | 04 |
| feature | Unified Plugin Zips |
| assigned_agent | generalPurpose |
| model | composer-2.5-fast |
| token_budget | 200000 |
| state | completed |
| started_at | 2026-09-15T07:35:41.648Z |
| last_heartbeat | 2026-09-15T07:57:38.772Z |
| completed_at | 2026-09-15T07:46:54.233Z |
| git_sha |  |
| agent_session_id |  |
<!-- status:metadata:end -->

<!-- status:checklist:start -->
- [x] **D01** — Adapt `service/hooks.py` (or create `service/plugin_backend.py`) to (`service/plugin_backend.py`)
- [x] **D02** — Enforce gate: backend module only imported if both (`service/plugins.py`)
- [x] **D03** — Optional collector: when `datasource/collector.py` exists, load it (`service/plugin_datasource.py`)
- [x] **D04** — `datasource/streams.yml` handling: (`service/plugin_datasource.py`)
- [x] **D05** — Update `service/monitor.py` where necessary to publish plugin (`service/monitor.py`)
- [x] **D06** — Update or add tests: (`tests/test_plugin_backend.py`)
<!-- status:checklist:end -->

<!-- status:artifacts:start -->
- **created** `service/plugin_backend.py` — Unified backend artefacts and module names
- **created** `service/plugin_datasource.py` — streams.yml remap and collector host
- **modified** `service/hooks.py` — Load backend/service.py as plugin_<id>_backend
- **modified** `service/plugins.py` — Consent hashes plus catalog streams mapping
- **modified** `service/monitor.py` — Merge collector emits into 1 Hz snapshot
- **created** `tests/test_plugin_backend.py` — Gate consent sha256 teardown tests
- **created** `tests/test_plugin_datasource.py` — Remap collector bus gate tests
- **modified** `specs/20260915-unified-plugin-zips/subtask-04-unified-plugin-zips-backend-and-datasource-host-20260915.md` — Ticked Deliverables DoD and Execution Notes
<!-- status:artifacts:end -->

<!-- status:errors:start -->
_None._
<!-- status:errors:end -->

<!-- status:notes:start -->
Backend + datasource host landed. Unified backends load from
backend/service.py as plugin_<id>_backend; collectors from
datasource/collector.py as plugin_<id>_collector. Gate is existing
ZOTO_VIZ_PLUGIN_SERVICE truthy check plus consent covering
backend_sha256/collector_sha256 (stamp string unchanged; shader hash
is subtask 07). consumes[] remaps live on catalog streams and
plugin_streams; produces[] merge onto the 1 Hz snapshot (not descoped).
Targeted pytest 30 passed. token_budget 200000.

<!-- status:notes:end -->
