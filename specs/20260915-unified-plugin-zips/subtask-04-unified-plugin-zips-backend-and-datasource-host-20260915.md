# Subtask: Backend + Datasource Host

## Metadata
- **Subtask ID**: 04
- **Feature**: Unified Plugin Zips
- **Assigned Subagent**: generalPurpose
- **Dependencies**: 03
- **Created**: 20260915

## Objective

Give the unified plugin format its Python side: hot-load
`backend/service.py` (setup / teardown / on_snapshot) and optional
`datasource/collector.py` from the unpacked tree, wire
`datasource/streams.yml` into the monitor pipeline, and keep the existing
consent + `ZOTO_VIZ_PLUGIN_SERVICE` gates in place.

## Deliverables Checklist

- [x] Adapt `service/hooks.py` (or create `service/plugin_backend.py`) to
      load `backend/service.py` from `plugins/.runtime/<id>/backend/service.py`
      when present. Contract stays: `setup(context)`, `teardown(context)`,
      `on_snapshot(snapshot, plugin_state)`. **No** capture-ring injection
      (unchanged from today).
- [x] Enforce gate: backend module only imported if both
  - `os.environ.get("ZOTO_VIZ_PLUGIN_SERVICE") == "1"` (or equivalent
    truthy check that mirrors the current implementation), **and**
  - the consent record for `<id>` covers the sha256 of every hot-loaded
    Python file (`backend/service.py` + `datasource/collector.py` if
    present).
- [x] Optional collector: when `datasource/collector.py` exists, load it
      under the same gates. Expose the collector interface (start / stop /
      emit) using whatever pattern `service/monitor.py` already uses; keep
      collector emissions routed through the existing stream fan-out so no
      new IPC path is introduced.
- [x] `datasource/streams.yml` handling:
  - `consumes[]` — subscribe to named monitor streams, optionally remap
    field names before passing to the frontend / backend hook. The mapping
    lives in the catalog entry produced by subtask 03 and is exposed via
    the `/plugins` HTTP payload for subtask 05/06 to consume.
  - `produces[]` — register new stream names on the monitor bus (creating
    them lazily). Only used when a collector is present.
- [x] Update `service/monitor.py` where necessary to publish plugin
      collector output through the normal snapshot machinery. Concrete
      insertion points:
  - Grep for the snapshot-emit path (`_snapshot`, `snapshot_dict`, or
    the equivalent 1 Hz builder that ends in a `web.json_response(...)`
    / websocket send). That is where collector `emit()` writes land.
  - The collector-registration path piggybacks on
    `service/hooks.py::sync`; the new registration happens in the same
    place a plugin's `backend/service.py` is loaded so the two share a
    lifecycle.
  - Do **not** introduce a new asyncio task per plugin — reuse the
    monitor loop and hand collector emissions to the existing stream
    fan-out.
  - **Descope note**: no shipped example plugin currently uses
    `datasource/produces[]` (lan-pulse's `produces[]` is declared but
    its backend does not emit; see subtask 09's real layout). If the
    concrete monitor insertion is non-trivial, ship `consumes[]` +
    field remap in v1 and defer `produces[]` publishing to a follow-up
    spec — call this out in the subtask's Execution Notes.
- [x] Update or add tests:
  - `tests/test_plugin_backend.py` — hot-load with and without consent,
    with and without `ZOTO_VIZ_PLUGIN_SERVICE`, sha256 mismatch, teardown
    on reload.
  - `tests/test_plugin_datasource.py` — streams.yml parsing, field
    remap, produced streams appear on the bus, collector obeys the gate.
  - Extend `tests/test_agent.py` only if it currently references the old
    agent_plugins backend; otherwise leave untouched.

## Definition of Done

- [x] With consent + `ZOTO_VIZ_PLUGIN_SERVICE=1`, a plugin's
      `backend/service.py` runs setup on catalog load and teardown on
      plugin removal / hash change.
- [x] Without consent OR without the env flag, backend + collector code
      is **never** imported (verify via `sys.modules` in the test).
- [x] Editing the backend file changes its sha256; catalog reload refuses
      to hot-load until consent is re-stamped.
- [x] `on_snapshot` receives the same shape it does today (mutation of
      snapshot + `plugin_state` allowed; capture ring untouched).
- [x] `streams.yml consumes` produces the expected remapped payload;
      `produces[]` streams appear in the monitor bus.
- [x] Targeted pytest passes:
      `pnpm exec pytest tests/test_plugin_backend.py tests/test_plugin_datasource.py tests/test_hooks.py -q`
      (only include modules that exist; add new ones as needed).

## Implementation Notes

- Reuse the sha256 helper from subtask 03. Consent record structure lives
  in `~/.zoto-viz/plugin-consent.yml` today — keep the schema, just extend
  the recorded artefacts to include backend + collector + (future) shader.
- Watch out for `service/hooks.py` and `service/monitor.py` being dirty
  in the current WIP; rebase carefully.
- Do not add new IPC. Collectors run in-process, same as
  `service/hooks.py` does today.
- Backends should be executed in a distinct module namespace per plugin
  (`plugin_<id>_backend`) so reloads replace the old module cleanly.
- Keep the existing plugin_state semantics from `service/hooks.py`
  (a per-plugin dict passed to `on_snapshot`); do not redesign it here.

## Testing Strategy

**Targeted only.** Run the specific pytest modules listed above. Full
suite is out of scope for this subtask.

## Execution Notes

### Agent Session Info
- Agent: generalPurpose
- Started: 2026-09-15T07:35:41Z
- Completed: 2026-09-15T07:46:54Z

### Work Log
- New `service/plugin_backend.py` names unified Python files, hashes them with `plugin_zip.plugin_sha256`, and attaches catalog artefacts (`backend_sha256`, `collector_sha256`, `streams`). Hot-load stays in `service/hooks.py` so `setup(host)` / `teardown(host)` / `on_snapshot(host, msg)` keep today's Host + snapshot contract (no capture-ring injection). Unified backends load as `plugin_<id>_backend`.
- `hooks.service_path` prefers `backend/service.py` over legacy `service/__init__.py` / `service.py`. `hooks.sync` still owns lifecycle and now also drives collector load/unload.
- Gate is unchanged `plugins.python_enabled()` truthy check (`1` / `true` / `yes` / `on`) plus consent. Consent stamp string is unchanged; records gained `backend_sha256` / `collector_sha256` so an edit invalidates hot-load until re-stamp. Shader hash left for subtask 07.
- New `service/plugin_datasource.py`: parse `datasource/streams.yml`, remap `consumes[]` fields (catalog `streams` mapping for `/plugins`; remapped copy under `plugin_streams` on the snapshot without mutating original keys), load `datasource/collector.py` as `plugin_<id>_collector` with start/stop/emit. No new asyncio task or IPC.
- `produces[]` shipped in v1: declared names are registered when a collector is loaded; `emit()` / `host.emit()` merge onto the 1 Hz snapshot in `monitor.publish_state` (the WebSocket fan-out). Undeclared emit keys are dropped. Not descoped.
- Merged conservatively with parallel subtask 05 (`has_frontend` / `optional_part_flags` on catalog rows). Only added Python hashes + `streams` mapping. Left `web/` and `tests/test_agent.py` alone.
- Targeted pytest: 30 passed (`test_plugin_backend.py`, `test_plugin_datasource.py`, `test_hooks.py`). Ruff clean on authored Python.

### Blockers Encountered
None.

### Files Modified
- created: `service/plugin_backend.py`, `service/plugin_datasource.py`, `tests/test_plugin_backend.py`, `tests/test_plugin_datasource.py`
- modified: `service/hooks.py`, `service/plugins.py`, `service/monitor.py`
