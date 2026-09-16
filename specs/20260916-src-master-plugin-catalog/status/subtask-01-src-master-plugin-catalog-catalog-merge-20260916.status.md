# Subtask 01 — Src-Master Plugin Catalog — live status

<!-- status:metadata:start -->
| Key | Value |
|-----|-------|
| schema_version | 1 |
| subtask_id | 01 |
| feature | Src-Master Plugin Catalog |
| assigned_agent | generalPurpose |
| model | composer-2.5-fast |
| token_budget | 200000 |
| state | completed |
| started_at | 2026-09-16T00:41:37.288Z |
| last_heartbeat | 2026-09-16T03:33:39.754Z |
| completed_at | 2026-09-16T03:27:39.160Z |
| git_sha |  |
| agent_session_id |  |
<!-- status:metadata:end -->

<!-- status:checklist:start -->
- [x] **D01** — Change `service/plugins.py::scan` so **both** `scan()` (no args /
- [x] **D02** — Keep the YAML/tree fallback: `scan(root)` on a directory with neither
- [x] **D03** — Frontend compile / Python hooks / sky GLSL for src rows read from
- [x] **D04** — Update `.gitignore`: add `plugins/*.zip`. Keep `plugins/.runtime/`.
- [x] **D05** — Update `service/paths.py` docstrings: `plugin_zips_dir` is the local
- [x] **D06** — Rewrite `tests/test_plugin_catalog.py` **before or atomically with**
- [x] **D07** — Delete untracked first-party `plugins/*.zip` from the working tree
- [x] **D08** — Delete `plugins/src/cpu-pong/` (duplicate of `cpupong` with
- [x] **D09** — Update `tests/test_paths.py::test_gitignore_runtime_not_zips_or_src`
- [x] **D10** — `schema/plugin.schema.json` top-level `description` may still say
<!-- status:checklist:end -->

<!-- status:artifacts:start -->
- **modified** `service/plugins.py` — src-first
- **modified** `service/plugins.py` — YAML
- **modified** `service/plugins.py` — src
- **modified** `.gitignore` — ignore
- **modified** `service/paths.py` — src
- **modified** `tests/test_plugin_catalog.py` — src
- **deleted** `plugins/watch.zip` — untracked
- **deleted** `plugins/layers.zip` — untracked
- **deleted** `plugins/air-ssid.zip` — untracked
- **deleted** `plugins/pulse-ts.zip` — untracked
- **deleted** `plugins/air-bt.zip` — untracked
- **deleted** `plugins/frogger.zip` — untracked
- **deleted** `plugins/protocols.zip` — untracked
- **deleted** `plugins/invaders.zip` — untracked
- **deleted** `plugins/lan-heat.zip` — untracked
- **deleted** `plugins/cores.zip` — untracked
- **deleted** `plugins/doom.zip` — untracked
- **deleted** `plugins/cpupong.zip` — untracked
- **deleted** `plugins/services.zip` — untracked
- **deleted** `plugins/command.zip` — untracked
- **deleted** `plugins/netpong.zip` — untracked
- **deleted** `plugins/topology.zip` — untracked
- **deleted** `plugins/load.zip` — untracked
- **deleted** `plugins/lan-pong.zip` — untracked
- **deleted** `plugins/lan-pulse.zip` — untracked
- **deleted** `plugins/talkers.zip` — untracked
- **deleted** `plugins/src/cpu-pong/plugin.yml` — duplicate
- **deleted** `plugins/src/cpu-pong/visualisation.yml` — duplicate
- **modified** `tests/test_paths.py` — gitignore
- **modified** `specs/20260916-src-master-plugin-catalog/subtask-01-src-master-plugin-catalog-catalog-merge-20260916.md` — execution
- **deleted** `plugins/src/cpu-pong/` — duplicate
<!-- status:artifacts:end -->

<!-- status:errors:start -->
_None._
<!-- status:errors:end -->

<!-- status:notes:start -->
Src-first catalog merge. Fix-list round: re-deleted plugins/src/cpu-pong/ (stayed gone after 6s and after pytest). plugins/src/cpupong/ remains. scan() and scan(PLUGINS) return 20 src ids (doom, lan-pulse included), 0 errors (no duplicate cpupong). Targeted pytest --no-cov 20 passed (test_plugin_catalog.py + test_paths.py). No live writer found; restore at 00:53:02Z was during first judge pass. Did not run full suite. Did not commit. Did not start Phase 2.

<!-- status:notes:end -->
