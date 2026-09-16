# Subtask 09 — Unified Plugin Zips — live status

<!-- status:metadata:start -->
| Key | Value |
|-----|-------|
| schema_version | 1 |
| subtask_id | 09 |
| feature | Unified Plugin Zips |
| assigned_agent | generalPurpose |
| model | composer-2.5-fast |
| token_budget | 200000 |
| state | completed |
| started_at | 2026-09-15 07:59:34.694000+00:00 |
| last_heartbeat | 2026-09-15T08:23:11.171Z |
| completed_at | 2026-09-15T08:13:33.772Z |
| git_sha |  |
| agent_session_id |  |
<!-- status:metadata:end -->

<!-- status:checklist:start -->
- [x] **D01** — Enumerate the sources to migrate:
- [x] **D02** — For each migrated plugin:
- [x] **D03** — Delete `examples/plugins/` and `examples/agent-plugins/` (once every
- [x] **D04** — Update any code that references the old example paths (grep for
- [x] **D05** — Regenerate the committed `plugins/*.zip` files deterministically so
- [x] **D06** — Add a test that scans the committed `plugins/` catalog on CI and
- [x] **D07** — **Deterministic-pack CI check**: add
<!-- status:checklist:end -->

<!-- status:artifacts:start -->
- **created** `plugins/src/air-bt` — migrated source tree
- **created** `plugins/src/air-ssid` — migrated source tree
- **created** `plugins/src/command` — migrated source tree
- **created** `plugins/src/cores` — migrated source tree
- **created** `plugins/src/cpupong` — migrated source tree
- **created** `plugins/src/doom` — migrated source tree
- **created** `plugins/src/frogger` — migrated source tree
- **created** `plugins/src/invaders` — migrated source tree
- **created** `plugins/src/lan-heat` — migrated source tree
- **created** `plugins/src/lan-pong` — migrated source tree
- **created** `plugins/src/lan-pulse` — migrated source tree
- **created** `plugins/src/layers` — migrated source tree
- **created** `plugins/src/load` — migrated source tree
- **created** `plugins/src/netpong` — migrated source tree
- **created** `plugins/src/protocols` — migrated source tree
- **created** `plugins/src/pulse-ts` — migrated source tree
- **created** `plugins/src/services` — migrated source tree
- **created** `plugins/src/talkers` — migrated source tree
- **created** `plugins/src/topology` — migrated source tree
- **created** `plugins/src/watch` — migrated source tree
- **deleted** `examples/plugins` — retired flat YAML + pulse-ts examples
- **deleted** `examples/agent-plugins` — retired lan-pulse agent-plugin example
- **modified** `tests/test_plugins.py` — retargeted to plugins/src
- **modified** `tests/test_hooks.py` — retargeted to plugins/src
- **modified** `tests/test_agent.py` — topology YAML from plugins/src
- **modified** `tests/test_plugin_schema.py` — shim fixtures from plugins/src
- **modified** `tests/test_agent_plugins.py` — inlined legacy lan-pulse fixtures
- **modified** `service/plugins.py` — seed() no-op; examples/plugins retired
- **modified** `service/agent_plugins.py` — dropped EXAMPLES path
- **modified** `docs/plugins.md` — example paths now plugins/src
- **modified** `docs/plugins-ts.md` — example path now plugins/src/pulse-ts
- **created** `plugins/air-bt.zip` — packed via plugin pack CLI
- **created** `plugins/air-ssid.zip` — packed via plugin pack CLI
- **created** `plugins/command.zip` — packed via plugin pack CLI
- **created** `plugins/cores.zip` — packed via plugin pack CLI
- **created** `plugins/cpupong.zip` — packed via plugin pack CLI
- **created** `plugins/doom.zip` — packed via plugin pack CLI
- **created** `plugins/frogger.zip` — packed via plugin pack CLI
- **created** `plugins/invaders.zip` — packed via plugin pack CLI
- **created** `plugins/lan-heat.zip` — packed via plugin pack CLI
- **created** `plugins/lan-pong.zip` — packed via plugin pack CLI
- **created** `plugins/lan-pulse.zip` — packed via plugin pack CLI
- **created** `plugins/layers.zip` — packed via plugin pack CLI
- **created** `plugins/load.zip` — packed via plugin pack CLI
- **created** `plugins/netpong.zip` — packed via plugin pack CLI
- **created** `plugins/protocols.zip` — packed via plugin pack CLI
- **created** `plugins/pulse-ts.zip` — packed via plugin pack CLI
- **created** `plugins/services.zip` — packed via plugin pack CLI
- **created** `plugins/talkers.zip` — packed via plugin pack CLI
- **created** `plugins/topology.zip` — packed via plugin pack CLI
- **created** `plugins/watch.zip` — packed via plugin pack CLI
- **created** `tests/test_plugin_catalog.py` — catalog scan + doom/lan-pulse smokes + pack repro
- **modified** `docs/contributing.md` — TODO(subtask-10) zlib/cross-machine pack caveat
<!-- status:artifacts:end -->

<!-- status:errors:start -->
_None._
<!-- status:errors:end -->

<!-- status:notes:start -->
Migrated 20 plugins (18 flat YAML views + pulse-ts + lan-pulse) into plugins/src/<id>/ and packed plugins/<id>.zip via CLI.

Dropped lan-pulse skills/generate-ui/ and ui/prompt.md (v1 has neither). produces/consumes are declarative-only; no datasource/collector.py and no sky/. Follow-up if a maximal collector+sky example is wanted.

pulse-ts service/__init__.py landed as backend/service.py (unified convention). Doom arcade engine stays in web/src/arcade/; plugins/src/doom is plugin.yml + visualisation.yml with engine: doom → arcadeId dispatch.

plugins.seed() is a no-op. docs/contributing.md has TODO(subtask-10) for zlib/cross-machine pack caveat.

Tests: .venv/bin/python3 -m pytest tests/test_plugin_catalog.py -q -o addopts= (4 passed). Also retargeted test_plugins/hooks/agent/plugin_schema/agent_plugins. Pre-existing test_agent_plugins.py::test_cli_zip still fails (plugins._cli_zip removed in subtask 03) — out of scope.

Grep-clean outside specs/: no remaining examples/plugins or examples/agent-plugins references.
<!-- status:notes:end -->
