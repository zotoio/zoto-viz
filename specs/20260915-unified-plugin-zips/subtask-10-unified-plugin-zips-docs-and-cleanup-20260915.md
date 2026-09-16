# Subtask: Docs + Cleanup

## Metadata
- **Subtask ID**: 10
- **Feature**: Unified Plugin Zips
- **Assigned Subagent**: generalPurpose
- **Dependencies**: 07, 08, 09, 11
- **Created**: 20260915

## Objective

Land the docs sweep and remove every remnant of the two legacy plugin
systems. This is the last subtask; the full test suite is expected to run
cleanly here.

## Deliverables Checklist

- [ ] Docs rewrite:
  - `docs/plugins.md` (**update**) — single source of truth for the
    unified format (zip contract, folder layout, consent, CLI, MCP
    tool, agent flow, MCP write safety guards).
  - `docs/plugins-ts.md` (**create** — file does not exist today) —
    TypeScript-facing docs: `frontend/` layout, capability allowlist,
    iframe sandbox (`web/src/plugins/host.ts::PluginSandbox`), module
    URL shape.
  - `docs/api.md` (**update**) — refresh any references to
    `install_plugin_zip`, the `/plugins` HTTP payload, and the plugin
    module URL. Cover the new dirty-tree / no-auto-commit response
    shapes.
  - `docs/install.md` (**update**) — cover the new `plugins/` catalog,
    how zips ship with the repo, `ZOTO_VIZ_REPO_ROOT` under systemd,
    and the first-startup migration story.
  - `docs/agent.md` (**update**) — refresh the agent-facing
    draft-plugin flow (`api_draft_plugin`'s new `{files, install}`
    shape; operator runs `plugin pack` + `git add`).
  - `docs/contributing.md` (**update**) — explain the
    `plugins/src/<id>/` + `plugin pack` loop, deterministic-pack
    caveats (pinned Python + zlib), the `ZOTO_VIZ_LEGACY_PLUGINS`
    rollback flag, and that every view is a catalog plugin (host engines
    are wrap targets, not menu rows).
- [ ] **Retire the `ZOTO_VIZ_LEGACY_PLUGINS` opt-in.** After one green
      release under the flag, delete the guarded code path in
      `service/plugins.py` / `service/mcp.py` and the fallback that
      re-seeds `~/.zoto-viz/plugins/`.
- [ ] Delete `service/agent_plugins.py`. If any helper still lives there,
      fold it into `service/plugins.py` first. Ensure no imports remain
      (grep and adjust).
- [ ] **Delete `tests/test_agent_plugins.py`.** The file imports
      `service.agent_plugins` and will fail the full-suite pass once the
      module is gone. If any of its cases still cover a surviving code
      path (e.g. a helper folded into `service/plugins.py`), port those
      cases into `tests/test_plugins.py` before deleting the file.
- [ ] Delete the old schemas if subtask 01 left shims:
      `schema/view-plugin.schema.json` and
      `schema/agent-plugin.schema.json`.
- [ ] Remove or update any lingering references to
      `~/.zoto-viz/plugins/` and `~/.zoto-viz/agent-plugins/` in docs,
      code comments, and tests. Consent path (`~/.zoto-viz/plugin-consent.yml`)
      stays.
- [ ] Full-suite verification (this is the wrap-up phase):
      `pnpm exec pytest -q` and `pnpm --filter web test`.
- [ ] Run `pnpm -w lint` (or the closest equivalent) and address anything
      that regressed.
- [ ] Update the spec's `Execution Notes` in the index with a short
      "what's changed" summary + follow-ups if any were opened.

## Definition of Done

- [ ] Every doc listed above reflects the unified format only — no
      references to two plugin systems, view-plugin schema, or
      agent-plugin schema. `docs/plugins-ts.md` is a **new** file.
- [ ] `service/agent_plugins.py` is gone; imports across the tree still
      resolve. `tests/test_agent_plugins.py` is also gone (with any
      still-relevant cases ported into `tests/test_plugins.py`).
- [ ] `ZOTO_VIZ_LEGACY_PLUGINS` gate is removed from `service/plugins.py`
      and `service/mcp.py`; grep is clean.
- [ ] Old schema files are gone (no shims left over).
- [ ] `pnpm exec pytest -q` passes.
- [ ] `pnpm --filter web test` passes.
- [ ] Lint passes.
- [ ] Grep for `~/.zoto-viz/plugins` and `~/.zoto-viz/agent-plugins` is
      clean except for the consent path.

## Implementation Notes

- Docs in the current tree are dirty (`docs/agent.md`, `docs/api.md`,
  `docs/camera.md`, `docs/live.md`, `docs/motion.md`, `docs/plugins.md`).
  Rebase onto whatever landed and merge the plugin content carefully.
- Keep migration notes short. Users of the old system get a one-paragraph
  pointer: "the two plugin systems have been unified — see
  `docs/plugins.md`."
- If the WIP doom or sky-ai work moved anything referenced in docs, keep
  those references intact rather than dropping them.
- Because this subtask runs the full suite, expect ~minutes-scale test
  time. If anything fails, fix or open a targeted follow-up rather than
  weakening the tests.

## Testing Strategy

**Full suite runs here** as part of the executor's wrap-up:

```
pnpm exec pytest -q
pnpm --filter web test
pnpm -w lint       # or the project's canonical lint command
```

Report failures with the specific test names + files touched.

## Execution Notes

Docs now describe the unified zip catalog only. `ZOTO_VIZ_LEGACY_PLUGINS`,
`service/agent_plugins.py`, `tests/test_agent_plugins.py`, and the
`view-plugin` / `agent-plugin` schema shims are gone. First-startup
migration still copies leftover user-dir trees into `plugins/src/<id>/`
(no auto-pack). MCP `install_plugin_zip` is catalog-only.

### Fix-round (judge Partial / D03)

Dropped `service.agent_plugins` from `pytest.ini` `--cov=` and
`[coverage:run] source`. Remaining `agent_plugins` hits outside `specs/`
are allowed migration helpers (`paths.agent_plugins_dir` /
`plugin_migration`) plus `tests/test_mcp.py` asserting the retired MCP
tool name is unknown. Targeted pytest with coverage config applied:
`tests/test_plugins.py` — 14 passed; no `CoverageWarning` for
`service.agent_plugins`.

### Fix-round (quality-audit / module.js 403 overclaim)

`docs/plugins-ts.md` and `docs/api.md` said `GET /api/plugins/<id>/module.js`
403s without consent. `service/plugins.py` `api_module` does not check consent
(404 only if missing). Consent for frontend is the UI/sandbox gate
(`loadTsPlugin` / `tsPluginsAllowed` + source-review). GLSL remains accurate:
`api_sky` 403s without review. `docs/plugins.md` did not repeat the overclaim.

### Agent Session Info
- Agent: generalPurpose (composer-2.5-fast)
- Started: 2026-09-15T08:46:20Z
- Completed: 2026-09-15

### Work Log
- Rewrote `docs/plugins.md` (zip contract embed), created/refreshed
  `docs/plugins-ts.md`, updated api/install/agent/contributing/systemd
  and README. `ZOTO_VIZ_REPO_ROOT` detection + zlib pack caveat landed.
- Retired legacy MCP tools, `/api/agent-plugins`, and `seed_legacy_home`.
- Ported `cli_zip_deprecated` missing-file case into `tests/test_plugins.py`
  (and `test_plugin_cli.py`); deleted `test_agent_plugins.py`.
- Repacked `plugins/air-ssid.zip` after hint text change.
- Full suite: pytest 201 passed; vitest 140 passed (35 files).
- Lint: ruff clean on touched plugin files; `cd web && pnpm exec tsc --noEmit`
  after filling `TrafficMsg.summary` in `web/src/ui/feed.test.ts`.
  `ruff check service/monitor.py` still reports pre-existing E402/E741/E702/F841
  (import-after-zotoviz pattern, semicolons, unused `proto_num`).

### Blockers Encountered
None.

### Follow-ups
- Vitest logs `ECONNREFUSED 127.0.0.1:3000` twice but all tests pass (pre-existing
  noise, not a plugin regression).
- Pre-existing ruff findings in `service/monitor.py` left as-is (out of plugin
  cleanup scope).

### Files Modified
See status.yml artifacts.
