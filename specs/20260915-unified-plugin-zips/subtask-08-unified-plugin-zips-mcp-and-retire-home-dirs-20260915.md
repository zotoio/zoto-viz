# Subtask: MCP `install_plugin_zip` + Retire Home Plugin Dirs + Agent Draft

## Metadata
- **Subtask ID**: 08
- **Feature**: Unified Plugin Zips
- **Assigned Subagent**: generalPurpose
- **Dependencies**: 03, 04, 05, 07
- **Created**: 20260915

## Objective

Point every remote installation path at the new committed catalog:
`install_plugin_zip` MCP tool writes into `plugins/*.zip` and triggers an
unpack, home-directory plugin stores stop being seeded/mirrored, and the
agent-facing "draft a plugin" tool produces the new inner layout.

## Deliverables Checklist

- [ ] Update `service/mcp.py`:
  - `install_plugin_zip` writes the incoming zip into
    `plugin_zips_dir()/<id>.zip` (from subtask 02), runs the safety /
    schema validation from subtask 03, then triggers unpack into
    `plugin_runtime_dir()/<id>/`. Return the plugin id + version + sha256
    + written path + list of detected optional parts.
  - Refuse overwrite unless the caller passes `overwrite: true` **and**
    `plugins/<id>.zip` differs by sha256 (mirror the CLI `--force`
    contract from subtask 03).
  - **Loopback-only guard** stays intact — reject any request whose Host
    header is not loopback (current `service/mcp.py` behaviour).
  - **Dirty-tree guard**: refuse to write when `plugins/<id>.zip`,
    `plugins/src/<id>/`, or `plugins/.runtime/<id>/` has uncommitted
    changes (git status --porcelain on those paths) unless the caller
    passes `force: true`. Emit a structured `dirty_tree` response so
    the agent can prompt the operator.
  - **No auto-commit** — return the written path in the response;
    never call `git add` / `git commit`. Docs (subtask 10) tell the
    operator how to promote (`git add plugins/<id>.zip`).
  - Emit a `consent-required` response (using the shared validator
    subtask 07 exports as `consented_for`) when TypeScript, Python, or
    GLSL is present and the current consent stamp does not cover the
    new hashes.
- [ ] Delete the mirroring logic that copies from
      `~/.zoto-viz/agent-plugins/` into `~/.zoto-viz/plugins/` (grep for
      `mirror_into_view_plugins` in `service/agent_plugins.py` and its
      callers in `service/mcp.py`).
- [ ] Stop seeding `~/.zoto-viz/plugins/` from `examples/plugins/`. The
      repo catalog is the only source.
- [ ] Confirm subtask 03 fully retired `zoto-viz.py plugin install` (and
      that the systemd-override behaviour moved to `zoto-viz.py install`
      or a follow-up spec) — grep for lingering references in
      `service/mcp.py`, docs, and MCP tool descriptions.
- [ ] **First-startup migration** (owns the plan in the spec index's
      User-data migration section). On monitor startup:
  - Scan `~/.zoto-viz/agent-plugins/*/manifest.json` and
    `~/.zoto-viz/plugins/*.yml` (+ `~/.zoto-viz/plugins/*/plugin.yml`).
  - For each id **not** already present in `plugins/*.zip` or
    `plugins/src/<id>/`, copy the source into `plugins/src/<id>/`,
    translating the old agent-plugin layout: `manifest.json` →
    `plugin.yml` + `visualisation.yml`; `scripts/frontend/` →
    `frontend/`; `scripts/backend/` → `backend/`; `skills/` and `ui/`
    are dropped (with a follow-up note logged) since v1 has no home
    for them.
  - Emit one `[plugin-migrate] <id> copied to plugins/src/<id>/ — run
    'zoto-viz.py plugin pack <id>' to commit` line per migrated plugin.
  - Do **not** auto-pack, do **not** auto-commit, do **not** delete
    the legacy home tree (the `ZOTO_VIZ_LEGACY_PLUGINS` rollback still
    needs it).
  - Add `tests/test_plugin_migration.py` (temp home dir fixture; asserts
    the copy + skip-if-present behaviour + no auto-commit side effects).
- [ ] **Rollback flag `ZOTO_VIZ_LEGACY_PLUGINS`**: when set to `1`,
      keep `service/agent_plugins.py` alive, re-seed
      `~/.zoto-viz/plugins/` from `examples/plugins/` at startup, and
      register the old MCP tool alongside the new one. Default (unset)
      runs only the new catalog. Subtask 10 removes the flag + the
      guarded code path.
- [ ] Update the agent-facing "draft a plugin" flow. Today
      `service/agent.py::api_draft_plugin` (line ~786) takes `{yaml:
      str, install: bool}`, validates the YAML against the view-plugin
      schema, and (when `ai_control_on()` and `install` are both true)
      writes a single file to `plugins.DIR / f"{doc['id']}.yml"`. The
      new I/O:
  - Input: `{files: {path: contents}, install: bool}` — a small dict
    of relative paths inside a plugin-src tree (at minimum
    `plugin.yml`), each string content already sanitised for length.
  - Behaviour: validate every file against the unified schema (subtask
    01) and the zip-safety allowed-suffix set (subtask 03). When
    `ai_control_on() and install`, write the tree to
    `plugin_src_dir() / doc.id / ...`; when either is false, return
    the preview only.
  - Do **not** call `plugin pack` from the agent — the operator runs
    it. Response includes the list of written paths and a hint to run
    `zoto-viz.py plugin pack <id>`.
  - Extend `tests/test_agent.py` for the new I/O shape (paired with
    the consent-stamp assertions that already live there — subtask 07
    already extended them; this subtask consumes that landing).
- [ ] Tests:
  - Extend `tests/test_mcp.py` (or add `tests/test_mcp_install_plugin.py`)
    to cover the new write target, the overwrite guard, and consent
    responses.
  - Extend `tests/test_agent.py` to assert the draft-plugin output is the
    new layout.

## Definition of Done

- [ ] `install_plugin_zip` writes to `plugins/*.zip` (with the loopback,
      dirty-tree, and no-auto-commit guards enforced) and no longer
      touches `~/.zoto-viz/agent-plugins/` or `~/.zoto-viz/plugins/`
      unless `ZOTO_VIZ_LEGACY_PLUGINS=1` is set.
- [ ] No mirroring code path remains between the two legacy home dirs
      (except behind the rollback flag).
- [ ] `zoto-viz.py plugin install` is fully retired (per subtask 03) —
      grep clean in `service/mcp.py`, docs, and MCP tool descriptions.
- [ ] First-startup migration copies any plugin under
      `~/.zoto-viz/plugins/` or `~/.zoto-viz/agent-plugins/` into
      `plugins/src/<id>/` and logs a `plugin pack` pointer (no
      auto-pack, no auto-commit).
- [ ] `ZOTO_VIZ_LEGACY_PLUGINS=1` re-enables the legacy scanner + MCP
      tool + home-dir seeding. Default (unset) runs only the new catalog.
- [ ] Agent-drafted plugins land as `plugins/src/<id>/` trees that pass
      `zoto-viz.py plugin validate`. `api_draft_plugin` accepts the new
      `{files: {...}, install}` shape and returns the written paths.
- [ ] Targeted pytest passes:
      `pnpm exec pytest tests/test_mcp.py tests/test_agent.py tests/test_plugin_migration.py -q`
      (adjust module list based on what you touch).
- [ ] No linter errors.

## Implementation Notes

- `service/agent_plugins.py` is **not** removed here — subtask 10 owns the
  final deletion. Once this subtask lands, `agent_plugins.py` should be
  effectively unused (no imports from anywhere else); leave a top-of-file
  comment noting subtask 10 will delete it.
- Consent enforcement: rely on the same code path subtask 07 extended for
  shader hashes; the MCP tool should just call the shared validator and
  bubble the result up to the caller.
- Preserve the wire shape of `install_plugin_zip` where reasonable —
  agents currently know how to call it; add fields rather than rename
  existing ones.
- Grep for `agent_plugins` usages so nothing (frontend list endpoint,
  monitor start-up, tests) still imports it after this subtask.

## Testing Strategy

**Targeted only.** Run:

```
pnpm exec pytest tests/test_mcp.py tests/test_agent.py -q
```

Add the new module if you introduce one. Do **not** run the full pytest
suite; the executor's final phase covers it.

## Execution Notes

Fix-round after quality-audit `fix_list` (token_budget 200000).

### Agent Session Info
- Agent: generalPurpose (re-spawned)
- Started: 2026-09-15T09:29Z
- Completed: 2026-09-15T09:32Z

### Work Log
- F01: `service/agent.py` SYSTEM no longer asks for a single view-plugin YAML /
  `runtime: typescript`. Drafts are a files tree: required `plugin.yml`, optional
  `visualisation.yml`, `frontend/`, `backend/`, `datasource/`, `sky/`.
- F02: `dirty_tree_paths()` returns `git:unavailable` on `OSError` (git missing)
  and on `git status` nonzero, so MCP `install_plugin_zip` fail-closes unless
  `force: true`.
- Tests: `.venv/bin/python3 -m pytest tests/test_agent.py tests/test_plugin_migration.py tests/test_mcp.py -q -o addopts=` — 42 passed.

### Blockers Encountered
None.

### Files Modified
- `service/agent.py`
- `service/plugin_migration.py`
- `tests/test_agent.py`
- `tests/test_plugin_migration.py`
- `tests/test_mcp.py`
