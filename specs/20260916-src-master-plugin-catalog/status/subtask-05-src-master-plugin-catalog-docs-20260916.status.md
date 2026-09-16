# Subtask 05 — Src-Master Plugin Catalog — live status

<!-- status:metadata:start -->
| Key | Value |
|-----|-------|
| schema_version | 1 |
| subtask_id | 05 |
| feature | Src-Master Plugin Catalog |
| assigned_agent | generalPurpose |
| model | composer-2.5-fast |
| token_budget | 200000 |
| state | completed |
| started_at | 2026-09-16T03:46:45.952Z |
| last_heartbeat | 2026-09-16T03:56:57.371Z |
| completed_at | 2026-09-16T03:50:55.178Z |
| git_sha |  |
| agent_session_id |  |
<!-- status:metadata:end -->

<!-- status:checklist:start -->
- [x] **D01** — `docs/plugins.md` — catalog is `plugins/src/<id>/`; zips are local
- [x] **D02** — `docs/contributing.md` — edit src → validate → (optional)
- [x] **D03** — `docs/install.md` — shipped views are src trees; unpack cache is
- [x] **D04** — `docs/api.md` — `GET /api/plugins` payload is the merge; MCP writes
- [x] **D05** — `docs/agent.md` — draft hint: src is live; share with `plugin pack -o`.
- [x] **D06** — `docs/plugins-ts.md` — authoring under `plugins/src/<id>/` is live
- [x] **D07** — `README.md` — catalog line matches src-as-master.
- [x] **D08** — `schema/plugin.schema.json` top-level `description` and
- [x] **D09** — `zoto-viz.py` module docstring / `plugin` help strings if they still
- [x] **D10** — Grep the repo (docs, README, comments in `service/plugin_zip.py`,
- [x] **D11** — Do **not** mention npm as a way to install or publish plugins.
- [x] **D12** — Run full `pytest` and `web` vitest; fix regressions caused by this
<!-- status:checklist:end -->

<!-- status:artifacts:start -->
- **modified** `docs/plugins.md` — src catalog, zip contrib, sample fixture, pack -o/dist
- **modified** `docs/contributing.md` — edit src, git add src only, sample.zip pack identity
- **modified** `docs/install.md` — src trees live, .runtime for zip contrib, migrate is live
- **modified** `docs/api.md` — merge payload, MCP gitignored zip + src refuse, draft src live
- **modified** `docs/agent.md` — draft src live, share with plugin pack -o
- **modified** `docs/plugins-ts.md` — src authoring live, no pack for iframe
- **modified** `README.md` — catalog line is plugins/src
- **modified** `schema/plugin.schema.json` — zip is contrib interchange; src is first-party
- **modified** `schema/plugin-zip-contract.md` — contrib interchange layout
- **modified** `zoto-viz` — plugin help is src catalog + contrib zips
- **modified** `service/plugins.py` — plugin subparser help
- **modified** `service/plugin_zip.py` — pack identity gated on sample.zip only
<!-- status:artifacts:end -->

<!-- status:errors:start -->
_None._
<!-- status:errors:end -->

<!-- status:notes:start -->
Docs retargeted to src-as-catalog / zip-as-contrib. pytest 279 passed, vitest 176 passed. No leftover 01–04 suite fixes. No npm plugin path. token_budget 200000. No git commit.
<!-- status:notes:end -->
