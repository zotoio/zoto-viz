# Execution Report: Unified Plugin Zips

**Spec**: `spec-unified-plugin-zips-20260915.md`
**Started**: 2026-09-15 06:49:18 UTC
**Completed**: 2026-09-15 09:17:30 UTC
**Duration**: 2h 28m 12s
**Status**: Completed

## Summary

All 11 subtasks were implemented by `generalPurpose` and adversarially **Verified**. The two plugin systems are now one zip catalog under `plugins/*.zip` with editable `plugins/src/<id>/`, a gitignored `plugins/.runtime/` unpack cache, CLI `plugin validate|list|pack|add`, MCP `install_plugin_zip` write guards, catalog-only live menu, optional frontend/backend/datasource/sky parts, and unified docs. Subtask 10 retired `ZOTO_VIZ_LEGACY_PLUGINS`, `service/agent_plugins.py`, and the legacy schema shims in this same spec (no follow-up deletion spec).

## Subtask Results

| ID | Subtask | Subagent | Verification | Files Modified | Notes |
|----|---------|----------|-------------|----------------|-------|
| 01 | Schema + zip contract | generalPurpose | Verified | 7 | `schema/plugin.schema.json`; old schemas shimmed then deleted in 10 |
| 02 | Paths + gitignore | generalPurpose | Verified | 8 | `repo_root` / plugin dir helpers; systemd `ZOTO_VIZ_REPO_ROOT` |
| 03 | Unpacker + scanner + CLI | generalPurpose | Verified | 6 | `service/plugin_zip.py`; `plugin install` retired; `plugin zip` deprecation alias |
| 04 | Backend + datasource host | generalPurpose | Verified | 6 | Hot-load gated on consent + `ZOTO_VIZ_PLUGIN_SERVICE`; `produces[]` shipped |
| 05 | Frontend compile + sandbox | generalPurpose | Verified | 8 | esbuild from `.runtime/<id>/frontend/`; `/api/plugins/<id>/module.js` |
| 06 | Visualisation + modes | generalPurpose | Verified | 10 | `PluginView`; plugin-on-plugin overlay; `look.backdrop = plugin` seam |
| 07 | Custom sky shader | generalPurpose | Verified | 11 | GLSL serve + whitelist; `consented_for`; `shader_sha256` |
| 08 | MCP + retire home dirs | generalPurpose | Verified | 9 | Catalog zip writes; dirty-tree; home-dir migrate; draft `{files,install}` |
| 09 | Migrate examples | generalPurpose | Verified | 20 plugins | 20 src trees + zips; examples trees deleted; catalog tests |
| 11 | Shipped views become plugins | generalPurpose | Verified | 8 | `allModes()` catalog-only; GRAPH_BASES + arcade wrap targets |
| 10 | Docs + cleanup | generalPurpose | Verified (after 1 Partial) | docs + deletes | First judge Partial on `pytest.ini` cov of deleted module; one fix-list respawn then Verified |

## Verification Results

### Adversarial Verification
- Subtasks verified: 11/11
- Issues found during verification: 1 (subtask 10 `pytest.ini` still covered `service.agent_plugins`)
- Issues resolved: 1 (fix-list respawn; fresh judge Verified)

### Test Suite
- Status: **PASS**
- Pytest: **201 passed** (90.16% coverage; 8 aiohttp `NotAppKeyWarning`s in `tests/test_access.py`)
- Vitest: **140 passed** / 35 files
- Vitest logs pre-existing `ECONNREFUSED 127.0.0.1:3000` twice; all tests still pass

### Linter
- Status: **CLEAN** on IDE diagnostics for touched plugin/frontend files
- `web` `tsc --noEmit`: clean (subtask 10)
- `service/monitor.py` still has pre-existing ruff E402/E741/E702/F841 (not a plugin regression)

### Quality Audit
- Status: **WARN** (read-only Step 5 judge)
- Holds: zip safety, MCP loopback/dirty-tree/no-auto-commit, Python + GLSL consent, catalog-only menu, 20 zips
- Findings (not blockers):
  1. `service/agent.py` system prompt still says “view-plugin schema”
  2. `docs/plugins-ts.md` claims `module.js` 403s without consent; `api_module` does not (GLSL does)
  3. Dirty-tree check fail-open if `git` is missing / `git status` fails
  4. Auditor also reported resurrected `examples/` trees; wrap-up `ls` shows they are **deleted** (git `D`)

### Documentation
- Status: **Updated**
- `docs/plugins.md`, new `docs/plugins-ts.md`, `docs/api.md`, `docs/install.md`, `docs/agent.md`, `docs/contributing.md`; VitePress sidebar includes TypeScript plugins

### onStop consistency check
- `spec-onstop-check.ts --human`: **exit 0** (`checked=13`, `critical=0`)

## Files Modified (all subtasks combined)

Created (spec-owned):
- `schema/plugin.schema.json`, `schema/plugin-zip-contract.md`
- `plugins/` catalog (`src/<id>/` + 20 `*.zip`)
- `service/plugin_zip.py`, `plugin_backend.py`, `plugin_datasource.py`, `plugin_sky.py`, `plugin_migration.py`
- `web/src/plugins/plugin-visualisation.ts`
- `tests/test_plugin_schema.py`, `test_plugin_zip.py`, `test_plugin_cli.py`, `test_plugin_backend.py`, `test_plugin_datasource.py`, `test_plugin_frontend.py`, `test_plugin_sky.py`, `test_plugin_catalog.py`, `test_plugin_migration.py`, `test_mcp.py`
- `docs/plugins-ts.md`

Deleted:
- `examples/plugins/`, `examples/agent-plugins/`
- `service/agent_plugins.py`, `tests/test_agent_plugins.py`
- `schema/view-plugin.schema.json`, `schema/agent-plugin.schema.json`

Modified (high-signal): `.gitignore`, `pytest.ini`, `zoto-viz.py`, `service/{plugins,paths,sysconfig,hooks,monitor,mcp,agent}.py`, `web/src/core/modes.ts`, `web/src/plugins/{plugin,host,plugin-ui}.ts`, `web/src/graph/backdrop.ts`, `web/src/ui/settings.ts`, plugin/docs tests.

WIP that coexisted (doom arcade, sky-ai, feed/markdown, etc.) was preserved where possible.

## Outstanding Items

- lan-pulse `skills/` and `ui/` dropped in v1 (logged in subtask 09)
- First-startup migration still copies leftover `~/.zoto-viz/{plugins,agent-plugins}/` into `plugins/src/` (no auto-pack)

The three quality-audit leftovers below were closed in the 2026-09-15 09:36 UTC fix round (see addendum).

## Lessons Learned

- Host `packageManager` is Yarn; spec-system CLIs were run via the plugin checkout’s `tsx` (`/home/andrewv/git/cursor/zoto-agents/plugins/zoto-spec-system`) with cwd at this repo.
- Parallel Phase 3 shared `service/plugins.py` / `plugin.ts`; sibling `plugin-visualisation.ts` reduced merge damage.
- Subtask 10 deleted the one-release legacy flag in-spec; assessment had allowed a follow-up spec instead.
- Aggregator watch PID **727536** (still running at report time).

## Addendum: quality-audit fix round (2026-09-15 09:36:36 UTC)

User rejected completion and chose `fix_all`. Originally-assigned `generalPurpose` agents for **08** and **10** were re-spawned in parallel; fresh judges then re-verified. User then approved; spec index marked **Completed**.

| Item | Owner | Change | Re-verify |
|------|-------|--------|-----------|
| Agent SYSTEM draft prompt | 08 | `service/agent.py` now drafts a unified `{files}` tree (`plugin.yml` + optional visualisation/frontend/backend/datasource/sky). `tests/test_agent.py` updated. | Judge **Verified**. Grep: no `view-plugin schema` / `runtime: typescript` in `service/agent.py`. |
| Dirty-tree fail-open | 08 | `dirty_tree_paths()` returns `git:unavailable` on OSError / nonzero `git status`; MCP refuses write unless `force`. Targeted tests added. | Judge **Verified**. Targeted pytest 42 passed (`test_agent` + `test_plugin_migration` + `test_mcp`). |
| `module.js` 403 overclaim | 10 | `docs/plugins-ts.md` and `docs/api.md`: frontend consent is UI/sandbox; `module.js` is 404-if-missing. GLSL `api_sky` still 403s without review. `docs/plugins.md` unchanged (never claimed it). | Judge **Verified**. |

onStop after this round: **exit 0** (`checked=13`, `critical=0`). Aggregator PID **727536** still running.
