# Subtask: Split src+zip test fixtures

## Metadata
- **Subtask ID**: 02
- **Feature**: Src-Master Plugin Catalog
- **Assigned Subagent**: generalPurpose
- **Dependencies**: 01
- **Created**: 20260916

## Objective

After the catalog merge, any test that writes **both** `plugins/src/<id>/`
and `plugins/<id>.zip` then calls `scan()` is a collision error. Split those
fixtures so shipped-path tests are src-only and unpack/contrib tests are
zip-only (no src tree). Leave CLI / MCP / migration tests to subtask 03.

## Deliverables Checklist

- [x] Update `tests/test_plugin_frontend.py` so compile/sandbox tests do
      not `pack_tree` into a zip **and** leave src in place before `scan()`.
      Src-only for “live from source”; zip-only (delete or never write src)
      for unpack-from-zip coverage.
- [x] Update `tests/test_plugin_sky.py` the same way (`_pack_sky` currently
      writes src then zip).
- [x] Update `tests/test_plugin_backend.py` the same way.
- [x] Update `tests/test_plugins.py` (and `tests/test_hooks.py` only if a
      fixture actually has both src and zip).
- [x] Do **not** edit `tests/test_plugin_cli.py`, `tests/test_mcp.py`,
      `tests/test_plugin_migration.py`, or `tests/test_agent.py` (subtask
      03 owns those).
- [x] Targeted pytest on the files this subtask touches passes.

## Definition of Done

- [x] None of the touched tests write both src and zip for the same id
      then `scan()` that repo.
- [x] Targeted pytest for the edited test files passes.
- [x] No linter errors in modified files.
- [x] Do **not** run the full suite (subtask 05).

## Implementation Notes

- Subtask 01 already rewrote `tests/test_plugin_catalog.py` and
  `tests/test_paths.py`. Do not reopen those unless a merge conflict
  appears.
- Prefer src-only for behaviour that is now the shipped path (compile from
  `frontend/`, load backend from src). Keep at least one zip-only fixture
  per area that previously unpacked from zip, so `.runtime/` still has
  coverage.
- If a helper both creates src and packs a zip, split it into
  `_write_src(...)` and `_pack_zip_only(...)` (zip members written without
  a src tree, or src removed before scan).

## Testing Strategy

**IMPORTANT**: Do NOT trigger global test suites during parallel execution. Instead:

- Create targeted tests for files being modified
- Run tests only on directly affected files
- Defer full test suite execution to the final verification phase

## Execution Notes

Split remaining src+zip fixtures so `scan()` never sees both for the same
id. Shipped-path tests write `plugins/src/<id>/` only. Unpack/contrib tests
pack from a staging tree outside `plugins/src/` (or never mkdir src).

### Agent Session Info
- Agent: generalPurpose (subtask 02)
- Started: 2026-09-16T03:34:34Z
- Completed: 2026-09-16T03:42:00Z

### Work Log
- `tests/test_plugin_frontend.py`: `_write_frontend_src` vs
  `_pack_frontend_zip_only`. Src compile+cache edits `frontend/index.ts` in
  src (no `.runtime`). Zip compile+cache still hits `.runtime`. YAML-only
  topology is src-only.
- `tests/test_plugin_sky.py`: `_write_sky_src` vs `_pack_sky_zip_only`.
  Consent/serve/hash-bump is src-only (edit src GLSL). Added zip-only unpack
  + `.runtime` hash bump. Compile-error and missing-sky are src-only.
- `tests/test_plugin_backend.py`: catalog hash scan is src-only. Added
  zip-only unpack hash coverage. Hooks unit tests still use a loose tree
  (YAML fallback, not a src+zip collision).
- `tests/test_plugins.py`: `test_scan_zip_catalog` is zip-only (pack from
  `tmp_path/pack`). `test_api_consent` is src-only (dropped both zips).
- `tests/test_hooks.py`: no fixture writes both src and zip; left untouched.
- Left CLI/MCP/migration/agent tests to subtask 03.
- Targeted pytest `--no-cov`: 31 passed
  (`test_plugin_frontend.py`, `test_plugin_sky.py`, `test_plugin_backend.py`,
  `test_plugins.py`).
- ruff clean on those four files.
- Did not run the full pytest/vitest suite. Did not commit.

### Blockers Encountered
None.

### Files Modified
- modified: `tests/test_plugin_frontend.py`, `tests/test_plugin_sky.py`,
  `tests/test_plugin_backend.py`, `tests/test_plugins.py`, this subtask file
