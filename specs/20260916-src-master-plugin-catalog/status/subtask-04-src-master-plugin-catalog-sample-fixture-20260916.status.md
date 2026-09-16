# Subtask 04 — Src-Master Plugin Catalog — live status

<!-- status:metadata:start -->
| Key | Value |
|-----|-------|
| schema_version | 1 |
| subtask_id | 04 |
| feature | Src-Master Plugin Catalog |
| assigned_agent | generalPurpose |
| model | composer-2.5-fast |
| token_budget | 200000 |
| state | completed |
| started_at | 2026-09-16T03:34:44.638Z |
| last_heartbeat | 2026-09-16T03:45:54.092Z |
| completed_at | 2026-09-16T03:38:56.641Z |
| git_sha |  |
| agent_session_id |  |
<!-- status:metadata:end -->

<!-- status:checklist:start -->
- [x] **D01** — Create `examples/plugins/sample/` with id `sample` (`plugin.yml` (`examples/plugins/sample/plugin.yml`)
- [x] **D02** — Pack with `plugin_zip.pack_tree` to `examples/plugins/sample.zip` and (`examples/plugins/sample.zip`)
- [x] **D03** — Default `plugins.scan()` must **not** include `id: sample` (fixture (`tests/test_plugin_sample.py`)
- [x] **D04** — Tests (`tests/test_plugin_sample.py` or extend catalog tests): (`tests/test_plugin_sample.py`)
- [x] **D05** — Do not add the sample to `plugins/src/`. Do not document npm. (`examples/plugins/sample/README.md`)
<!-- status:checklist:end -->

<!-- status:artifacts:start -->
- **created** `examples/plugins/sample/plugin.yml` — id sample + frontend/backend/datasource/capabilities
- **created** `examples/plugins/sample/visualisation.yml` — engine graph base topology
- **created** `examples/plugins/sample/frontend/index.ts` — minimal zoto.onTick stub
- **created** `examples/plugins/sample/backend/service.py` — setup teardown on_snapshot stubs
- **created** `examples/plugins/sample/datasource/streams.yml` — consumes devices produces plugin_state
- **created** `examples/plugins/sample/datasource/collector.py` — start/stop/emit no-op
- **created** `examples/plugins/sample/sky/sky.yml` — one-key recipe
- **created** `examples/plugins/sample/sky/fragment.glsl` — OK_FRAG whitelist uniforms
- **created** `examples/plugins/sample/README.md` — fixture not a shipped view
- **created** `examples/plugins/sample.zip` — pack_tree 2367 bytes all five parts
- **created** `tests/test_plugin_sample.py` — inspect detect_parts byte-identity scan()
- **modified** `specs/20260916-src-master-plugin-catalog/subtask-04-src-master-plugin-catalog-sample-fixture-20260916.md` — execution notes and checklist ticks
<!-- status:artifacts:end -->

<!-- status:errors:start -->
_None._
<!-- status:errors:end -->

<!-- status:notes:start -->
Packed examples/plugins/sample.zip via pack_tree (2367 bytes).
Targeted pytest tests/test_plugin_sample.py: 5 passed.
scan() has no id sample. No plugins/src/sample. No npm in README.
Did not commit. Did not run the full suite.

<!-- status:notes:end -->
