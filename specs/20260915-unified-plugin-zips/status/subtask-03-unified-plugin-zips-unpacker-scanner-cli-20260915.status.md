# Subtask 03 — Unified Plugin Zips — live status

<!-- status:metadata:start -->
| Key | Value |
|-----|-------|
| schema_version | 1 |
| subtask_id | 03 |
| feature | Unified Plugin Zips |
| assigned_agent | generalPurpose |
| model | composer-2.5-fast |
| token_budget | 200000 |
| state | completed |
| started_at | 2026-09-15T07:15:49.017Z |
| last_heartbeat | 2026-09-15T07:34:03.023Z |
| completed_at | 2026-09-15T07:30:45.314Z |
| git_sha |  |
| agent_session_id |  |
<!-- status:metadata:end -->

<!-- status:checklist:start -->
- [x] **D01** — New module `service/plugin_zip.py` (or equivalent name) housing: (`service/plugin_zip.py`)
- [x] **D02** — Extend or refactor `service/plugins.py` to: (`service/plugins.py`)
- [x] **D03** — Refresh `zoto-viz.py plugin` subcommands (`service/mcp.py` or the (`service/plugins.py`)
- [x] **D04** — Retire `zoto-viz.py plugin install` **fully** — do **not** alias it (`zoto-viz.py`)
- [x] **D05** — Rename `zoto-viz.py plugin zip <zipfile>` to (`service/plugins.py`)
- [x] **D06** — Add tests: (`tests/test_plugin_zip.py`)
<!-- status:checklist:end -->

<!-- status:artifacts:start -->
- **created** `service/plugin_zip.py` — Zip safety inspect unpack pack sha256
- **modified** `service/plugins.py` — Zip scanner catalog and plugin CLI
- **modified** `service/sysconfig.py` — Top-level install writes systemd override
- **modified** `zoto-viz.py` — plugin add plus top-level install
- **created** `tests/test_plugin_zip.py` — Zip safety unpack pack tests
- **created** `tests/test_plugin_cli.py` — validate list pack add install tests
- **modified** `tests/test_plugins.py` — Zip catalog scanner coverage
- **modified** `specs/20260915-unified-plugin-zips/subtask-03-unified-plugin-zips-unpacker-scanner-cli-20260915.md` — Ticked Deliverables DoD and Execution Notes
<!-- status:artifacts:end -->

<!-- status:errors:start -->
_None._
<!-- status:errors:end -->

<!-- status:notes:start -->
Unpacker + scanner + CLI landed. plugin install retired (systemd under
zoto-viz.py install). plugin zip is a deprecation alias for plugin add.
Targeted pytest 33 passed. token_budget 200000. TODO(subtask-10)
docs/contributing.md zlib pack determinism.

<!-- status:notes:end -->
