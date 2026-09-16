# Execution Report: Src-Master Plugin Catalog

**Spec**: `spec-src-master-plugin-catalog-20260916.md`
**Started**: 2026-09-16 00:38:46 UTC
**Completed**: 2026-09-16 04:02:57 UTC
**Duration**: 3h 24m 11s
**Status**: Completed with exceptions

## Summary

Default `scan()` now loads `plugins/src/<id>/` as the shipped catalog and merges non-colliding gitignored `plugins/*.zip`. Pack shares via `dist/<id>.zip` or `-o`; add/MCP hard-refuse src-owned ids. An all-features sample lives under `examples/plugins/` (not the live menu). Docs match src-as-catalog. Subtask 01 needed one fix-list respawn after `cpu-pong` reappeared during the first judge pass.

## Subtask Results

| ID | Subtask | Subagent | Verification | Files Modified | Notes |
|----|---------|----------|-------------|----------------|-------|
| 01 | Catalog merge + gitignore | generalPurpose | Verified (after 1 Failed) | ~25 | First judge Failed: `plugins/src/cpu-pong/` restored mid-review. User chose respawn; delete held; fresh judge Verified. |
| 02 | Split src+zip test fixtures | generalPurpose | Verified | 4 | Src-only vs zip-only helpers; 31 targeted tests. |
| 03 | CLI pack + MCP/add refuse | generalPurpose | Verified | 8 | Pack → `dist/` or `-o`; src refuse even with force; 58 targeted tests. |
| 04 | Sample zip fixture | generalPurpose | Verified | 11 | `examples/plugins/sample/` + `sample.zip`; 5 targeted tests. Zip on disk, not git-committed (execute does not commit). |
| 05 | Docs + full suite | generalPurpose | Verified | 12 | Docs/schema/help retargeted; pytest 279 + vitest 176. |

## Verification Results

### Adversarial Verification
- Subtasks verified: 5/5
- Issues found during verification: 1 (subtask 01 `cpu-pong` duplicate restored during first judge)
- Issues resolved: 1 (fix-list respawn + fresh judge)

### Test Suite
- Status: **PASS**
- Pytest (final verification): **279 passed** in 10.25s (coverage 88.63%; 8 aiohttp `NotAppKeyWarning`s in `tests/test_access.py`)
- Vitest (final verification): **176 passed** / 39 files
- Vitest logs pre-existing `ECONNREFUSED 127.0.0.1:3000` twice; all tests still pass

### Linter
- Status: **CLEAN** on IDE diagnostics for files touched in this spec
- Pre-existing ruff E741 in `zoto-viz` (`warn_warp` / `own_mac`) noted by the 05 judge; not introduced here

### Quality Audit
- Status: **PASS** (read-only Step 5 judge)
- Blockers: none
- Non-blockers: add/MCP refuse is directory-named (scan also owns `plugin.yml` id); `pack -o` can still write `plugins/<id>.zip`; `test_paths` does not lock `dist/`; dirty-tree docs example uses `plugins/src/sample`; `cpu-pong` local-history restore risk

### Documentation
- Status: **Updated**
- Files: `docs/plugins.md`, `docs/contributing.md`, `docs/install.md`, `docs/api.md`, `docs/agent.md`, `docs/plugins-ts.md`, `README.md`, `schema/plugin.schema.json`, `schema/plugin-zip-contract.md`

### onStop
- Exit **0** (`checked=19 fixes=0 critical=0`)

## Files Modified (all subtasks combined)

- modified: `service/plugins.py`, `service/paths.py`, `service/mcp.py`, `service/plugin_migration.py`, `service/agent.py`, `service/plugin_zip.py`, `.gitignore`, `zoto-viz`
- modified: `tests/test_plugin_catalog.py`, `tests/test_paths.py`, `tests/test_plugin_frontend.py`, `tests/test_plugin_sky.py`, `tests/test_plugin_backend.py`, `tests/test_plugins.py`, `tests/test_plugin_cli.py`, `tests/test_mcp.py`, `tests/test_plugin_migration.py`, `tests/test_agent.py`
- created: `tests/test_plugin_sample.py`
- created: `examples/plugins/sample/` (plugin.yml, visualisation.yml, frontend, backend, datasource, sky, README)
- created: `examples/plugins/sample.zip`
- modified: docs listed above; `schema/plugin.schema.json`; `schema/plugin-zip-contract.md`
- deleted: 20 untracked `plugins/*.zip`; `plugins/src/cpu-pong/`

## Outstanding Items

- Spec index Status remains **In Progress** until parent `approve_completion`.
- `examples/plugins/sample.zip` exists and is not gitignored; it was **not** `git add`ed or committed (execute does not commit).
- Watch for `plugins/src/cpu-pong/` coming back from editor/local history (duplicate `id: cpupong`).

## Lessons Learned

- Untracked trees the first 01 agent had read can reappear from Cursor local history during judging. After deleting a forbidden tree, re-check existence before closing.
- Host repo `packageManager: yarn` breaks `pnpm exec` for spec-system CLIs; invoke the plugin `tsx` binary with `--repo-root` / cwd at zoto-viz.
