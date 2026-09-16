# Subtask 01 — Unified Plugin Zips — live status

<!-- status:metadata:start -->
| Key | Value |
|-----|-------|
| schema_version | 1 |
| subtask_id | 01 |
| feature | Unified Plugin Zips |
| assigned_agent | generalPurpose |
| model | composer-2.5-fast |
| token_budget | 200000 |
| state | completed |
| started_at | 2026-09-15T06:54:54.758Z |
| last_heartbeat | 2026-09-15T07:14:19.783Z |
| completed_at | 2026-09-15T07:09:25.009Z |
| git_sha | f1e50b65f1f18ad0787bea3c763179138777ebc1 |
| agent_session_id |  |
<!-- status:metadata:end -->

<!-- status:checklist:start -->
- [x] **D01** — `schema/plugin.schema.json` — top-level schema for `plugin.yml` with (`schema/plugin.schema.json`)
- [x] **D02** — Sub-schemas cover: (`schema/plugin.schema.json`)
- [x] **D03** — Freeze the zip contract in a short `README.md` fragment (embedded (`schema/plugin-zip-contract.md`)
- [x] **D04** — Add a doc block (a top-level `description` in the JSON Schema is (`schema/plugin.schema.json`)
- [x] **D05** — Update `web/schema/*` references if the schema is copied there for (`schema/plugin.schema.json`)
- [x] **D06** — Delete `schema/view-plugin.schema.json` and (`schema/view-plugin.schema.json`)
- [x] **D07** — Add or update `tests/test_plugin_schema.py` to load (`tests/test_plugin_schema.py`)
- [x] **D08** — Add a test case that the shader uniform contract lives in the (`tests/test_plugin_schema.py`)
<!-- status:checklist:end -->

<!-- status:artifacts:start -->
- **created** `schema/plugin.schema.json` — Unified plugin.yml schema with visualisation/sky/streams/shader/zip defs
- **created** `schema/plugin-zip-contract.md` — Zip member README fragment for later docs/plugins.md embed
- **modified** `schema/view-plugin.schema.json` — One-line $ref shim to plugin.schema.json
- **modified** `schema/agent-plugin.schema.json` — One-line $ref shim to plugin.schema.json
- **modified** `service/plugins.py` — Follow sibling $ref shims via deref_schema
- **modified** `service/agent_plugins.py` — Resolve agent-plugin schema via plugins.deref_schema
- **created** `tests/test_plugin_schema.py` — min/max/invalid fixtures, shader grep, shim forward tests
- **modified** `specs/20260915-unified-plugin-zips/subtask-01-unified-plugin-zips-schema-and-zip-contract-20260915.md` — ticked Deliverables/DoD and filled Execution Notes
<!-- status:artifacts:end -->

<!-- status:errors:start -->
_None._
<!-- status:errors:end -->

<!-- status:notes:start -->
Shim choice: one-line $ref, not delete. Subtask 10 deletes the shims.
No web/schema copy. Targeted pytest 12 passed. token_budget 200000.

<!-- status:notes:end -->
