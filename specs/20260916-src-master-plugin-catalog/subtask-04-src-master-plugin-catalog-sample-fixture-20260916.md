# Subtask: All-features sample zip fixture

## Metadata
- **Subtask ID**: 04
- **Feature**: Src-Master Plugin Catalog
- **Assigned Subagent**: generalPurpose
- **Dependencies**: 01
- **Created**: 20260916

## Objective

Author one sample plugin that demonstrates **every** optional zip part, keep
its unpacked tree and a committed packed zip under `examples/plugins/`, and
assert pack byte-identity **only** for that zip. The sample is a contract
fixture: it must not appear in the live view menu.

## Deliverables Checklist

- [x] Create `examples/plugins/sample/` with id `sample` (`plugin.yml`
      `id: sample`, `name` + `version` required). Include **all** of:
      - `plugin.yml` — `frontend.entry`, `backend.entry`, `capabilities`
        (`graph.read` is enough), `datasource.consumes` / `produces`
      - `visualisation.yml` — `engine: graph`, `base: topology` (wrap a
        shipped graph base; not overlay-only)
      - `frontend/index.ts` — minimal `zoto.onTick` stub (mirror
        `plugins/src/pulse-ts/frontend/index.ts` at stub size)
      - `backend/service.py` — `setup` / `teardown` / `on_snapshot` stubs
      - `datasource/streams.yml` — at least one consume or produce stream
      - `datasource/collector.py` — a module that imports (stub `collect`
        or documented no-op matching `plugin_datasource` expectations)
      - `sky/sky.yml` — minimal recipe/pins valid against `$defs/sky`
      - `sky/fragment.glsl` — the known-good fragment from
        `tests/test_plugin_sky.py::OK_FRAG` (whitelist uniforms only)
      - `README.md` — states this is a zip-contract fixture, **not** a
        shipped view; live catalog is `plugins/src/`; share via
        `plugin pack` / drop zip into `plugins/`
- [x] Pack with `plugin_zip.pack_tree` to `examples/plugins/sample.zip` and
      **commit that zip**. Members must include `plugin.yml` plus paths that
      make `detect_parts` report `visualisation`, `frontend`, `backend`,
      `datasource`, and `sky`.
- [x] Default `plugins.scan()` must **not** include `id: sample` (fixture
      stays under `examples/`, not `plugins/src/sample/`).
- [x] Tests (`tests/test_plugin_sample.py` or extend catalog tests):
      - `inspect_zip(examples/plugins/sample.zip)` passes safety + schema
      - `detect_parts` / manifest parts include all five optional roots
      - `pack_tree(examples/plugins/sample, tmp.zip)` bytes equal the
        committed zip (the **only** pack-reproducibility assertion in the
        repo — core plugins are no longer byte-checked; src is canonical
        and zlib/DEFLATE drift on first-party zips is out of scope)
      - `plugins.scan()` (default) has no row `id == "sample"`
- [x] Do not add the sample to `plugins/src/`. Do not document npm.

## Definition of Done

- [x] `examples/plugins/sample/` is a valid src tree (`inspect_src` /
      `plugin validate` on that directory succeeds).
- [x] `examples/plugins/sample.zip` is tracked, ≤ zip size limits, and
      byte-identical to a fresh `pack_tree` on the pinned CI interpreter.
- [x] All five optional parts are present in the zip listing.
- [x] Sample is absent from the default catalog.
- [x] Targeted pytest for the new/updated sample test file passes.
- [x] No linter errors in modified files.
- [x] Do **not** run the full suite (subtask 05). Docs rewrite is 05;
      the sample README is in scope here.

## Implementation Notes

- Keep the sample **small**. Stubs, not a second lan-pulse. Sky fragment
  must pass `plugin_sky.validate_source`. Do not use `uMode` or AI Dynamic
  uniforms.
- `datasource/collector.py`: follow whatever
  `service/plugin_datasource.py` already loads (function names in that
  module). If a collector is optional when `streams.yml` exists, still
  ship a tiny module so the zip listing includes `datasource/collector.py`
  as the contract shows.
- `sky/sky.yml`: copy the smallest valid mapping used in
  `tests/test_plugin_sky.py` fixtures if one exists; otherwise `{ }` only
  if the schema allows it — prefer a one-key recipe that validates.
- Pack determinism: same `pack_tree` rules as today (sorted members, fixed
  mtimes). Document in the sample README that cross-machine zlib may
  differ; CI is the source of truth. First-party plugins are **not**
  re-packed for byte identity — that coverage reduction is intentional.
- Subtask 03 may land in parallel. Do not call `plugin pack` CLI if dest
  still points at `plugins/` on this branch; use `pack_tree` in tests and
  to generate the committed zip.

## Testing Strategy

**IMPORTANT**: Do NOT trigger global test suites during parallel execution. Instead:

- Create targeted tests for files being modified
- Run tests only on directly affected files
- Defer full test suite execution to the final verification phase

## Execution Notes

Authored the all-features sample fixture under `examples/plugins/sample/`
(id `sample`) with every optional zip part, packed it with
`plugin_zip.pack_tree` to `examples/plugins/sample.zip` (2367 bytes), and
added `tests/test_plugin_sample.py`. Default `scan()` does not list
`sample`; the tree is not under `plugins/src/`. README documents the
fixture / src-catalog / pack-for-share split and does not mention npm.

### Agent Session Info
- Agent: generalPurpose (subtask 04)
- Started: 2026-09-16T03:34:44Z
- Completed: 2026-09-16T03:38:56Z

### Work Log
- Created `examples/plugins/sample/` with `plugin.yml` (id/name/version,
  `frontend.entry`, `backend.entry`, `capabilities: [graph.read]`,
  `datasource.consumes` / `produces`), `visualisation.yml`
  (`engine: graph`, `base: topology`), stub frontend/backend, datasource
  `streams.yml` + `collector.py` (`start`/`stop`/`emit` no-ops matching
  `plugin_datasource`), `sky/sky.yml` (one-key recipe) + `sky/fragment.glsl`
  (`OK_FRAG` whitelist uniforms).
- Packed with `pack_tree` (not `plugin pack` CLI — dest may still point at
  `plugins/` until 03). Members: plugin.yml + visualisation, frontend,
  backend, datasource, sky. `git check-ignore` does not ignore the zip.
- `inspect_src` / `inspect_zip` / `cli_validate` on the tree and zip: ok.
- Default `scan()`: 20 catalog rows, no id `sample`. No `plugins/src/sample/`.
- Tests: `tests/test_plugin_sample.py` — inspect safety+schema, five parts,
  pack byte-identity vs committed zip, scan() omits sample, README has no npm.
- Targeted pytest: 5 passed (`tests/test_plugin_sample.py -q -o addopts=`).
- ruff clean on the sample tree and new test file.
- Did not run the full pytest/vitest suite. Did not commit. Did not edit
  `service/plugins.py`, `.gitignore`, CLI/MCP tests, or frontend/sky/backend
  plugin tests.

### Blockers Encountered
None.

### Files Modified
- created: `examples/plugins/sample/plugin.yml`
- created: `examples/plugins/sample/visualisation.yml`
- created: `examples/plugins/sample/frontend/index.ts`
- created: `examples/plugins/sample/backend/service.py`
- created: `examples/plugins/sample/datasource/streams.yml`
- created: `examples/plugins/sample/datasource/collector.py`
- created: `examples/plugins/sample/sky/sky.yml`
- created: `examples/plugins/sample/sky/fragment.glsl`
- created: `examples/plugins/sample/README.md`
- created: `examples/plugins/sample.zip`
- created: `tests/test_plugin_sample.py`
- modified: this subtask file (Execution Notes)
