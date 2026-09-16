# Subtask: Migrate Examples

## Metadata
- **Subtask ID**: 09
- **Feature**: Unified Plugin Zips
- **Assigned Subagent**: generalPurpose
- **Dependencies**: 03, 06
- **Created**: 20260915

## Objective

Convert every existing example plugin into the unified format:
`plugins/src/<id>/` source tree + packed `plugins/<id>.zip`. Those zips
**are** the views in the default catalog (subtask 11 removes the
hardcoded menu). Retire `examples/plugins/` and `examples/agent-plugins/`
once the migration is complete, keeping the WIP arcade `doom` engine
(`web/src/arcade/doom*.ts`) as the host wrap target for `plugins/src/doom/`.

## Deliverables Checklist

- [ ] Enumerate the sources to migrate:
  - **Flat view YAMLs** — 18 files at `examples/plugins/*.yml`. Each
    becomes `plugins/src/<id>/plugin.yml` + optional
    `plugins/src/<id>/visualisation.yml`. Explicit list (check each
    off as it lands):
    - `air-bt.yml`
    - `air-ssid.yml`
    - `command.yml`
    - `cores.yml`
    - `cpu-pong.yml`
    - `doom.yml` (WIP; see below)
    - `frogger.yml`
    - `invaders.yml`
    - `lan-heat.yml`
    - `lan-pong.yml`
    - `layers.yml`
    - `load.yml`
    - `netpong.yml`
    - `protocols.yml`
    - `services.yml`
    - `talkers.yml`
    - `topology.yml`
    - `watch.yml`
  - **`examples/plugins/doom.yml`** (WIP arcade view) — package as
    `plugins/src/doom/` (`plugin.yml` + `visualisation.yml`). The
    plugin does **not** ship a frontend of its own — the WIP arcade
    engine lives at `web/src/arcade/doom*.ts` and stays there for v1.
    After subtask 11 this zip is the Doom menu row.
  - **`examples/plugins/pulse-ts/`** — directory plugin with
    `plugin.yml`, `index.ts`, and `service/`. Ports to
    `plugins/src/pulse-ts/plugin.yml` + `visualisation.yml` +
    `frontend/index.ts` (renamed from top-level `index.ts`) +
    `backend/__init__.py` (renamed from `service/`).
  - **`examples/agent-plugins/lan-pulse/`** — the real layout on disk
    today is:
    - `manifest.json` (**not** `plugin.yml`)
    - `scripts/backend/service.py` → migrates to `backend/service.py`
    - `scripts/frontend/index.ts` → migrates to `frontend/index.ts`
    - `skills/generate-ui/SKILL.md` → **dropped** (v1 has no
      `skills/`; log a follow-up note in the subtask's Execution Notes)
    - `ui/prompt.md` → **dropped** (v1 has no `ui/`; log a follow-up
      note)
    - `manifest.json` fields (`produces`, `consumes`, `capabilities`,
      `engine`, `base`, `hint`) split into `plugin.yml` (id/name/
      version/hint/capabilities/datasource) + `visualisation.yml`
      (engine/base/look). Note: lan-pulse does **not** ship a `sky/`
      or a working `datasource/collector.py` today — its `produces[]`
      is declarative-only. Do not overclaim it as a maximal example.
- [ ] For each migrated plugin:
  - Write `plugins/src/<id>/plugin.yml` with id/name/version pulled from
    the source YAML (or invent a version `0.1.0` if none exists).
  - Split visualisation-shaped fields into
    `plugins/src/<id>/visualisation.yml`.
  - Move `frontend/`, `backend/`, `datasource/`, `sky/` folders straight
    across from the agent-plugin source.
  - Run `zoto-viz.py plugin validate plugins/src/<id>/` and fix errors.
  - Run `zoto-viz.py plugin pack <id>` to produce `plugins/<id>.zip`.
- [ ] Delete `examples/plugins/` and `examples/agent-plugins/` (once every
      plugin is migrated and the resulting zips validate + scan cleanly).
- [ ] Update any code that references the old example paths (grep for
      `examples/plugins`, `examples/agent-plugins`, `lan-pulse`, etc.).
- [ ] Regenerate the committed `plugins/*.zip` files deterministically so
      re-running `plugin pack` locally does not produce a diff.
- [ ] Add a test that scans the committed `plugins/` catalog on CI and
      confirms every zip validates against `schema/plugin.schema.json` and
      unpacks under the safety limits. This lives in
      `tests/test_plugin_catalog.py` and runs as part of the targeted set
      for subtasks 03 and 09. Extend the same test with a **doom smoke
      check**: load `plugins/doom.zip`, confirm the plugin catalog picks
      it up as the Doom **view** wrapping `arcadeId: "doom"` (subtask 11
      removes the shipped-mode overlay path; this smoke must not require
      overlay-only), and confirm the arcade engine at
      `web/src/arcade/doom.ts` still resolves through `arcadeId` dispatch. Add a similar smoke check for
      `plugins/lan-pulse.zip` (frontend + backend present; datasource
      declarative).
- [ ] **Deterministic-pack CI check**: add
      `tests/test_plugin_catalog.py::test_pack_is_reproducible` that
      re-packs every `plugins/src/<id>/` and asserts the resulting zip
      matches the committed `plugins/<id>.zip` byte-for-byte on the
      pinned Python + zlib. Document the cross-platform caveat in
      `docs/contributing.md` (subtask 10).

## Definition of Done

- [ ] `plugins/src/<id>/` exists for every migrated plugin with a passing
      `plugin validate`.
- [ ] `plugins/<id>.zip` exists for every migrated plugin and matches the
      output of `plugin pack` (deterministic).
- [ ] `examples/plugins/` and `examples/agent-plugins/` no longer exist.
- [ ] The WIP doom arcade engine still loads (arcade engine + its
      `plugins/src/doom/` bundle boot together).
- [ ] `pnpm exec pytest tests/test_plugin_catalog.py -q` passes.
- [ ] No stale references to the old example paths remain (grep clean).

## Implementation Notes

- `doom.yml` is on the current dirty branch — coordinate with whoever is
  landing the arcade engine; the plugin bundle may need frontend TS that
  is still in `web/src/arcade/*`. Prefer to leave the arcade TS in place
  and only ship a `plugin.yml` + `visualisation.yml` for `doom` in v1 if
  that keeps the WIP unblocked. Note the follow-up.
- `lan-pulse` on disk today has `scripts/backend`, `scripts/frontend`,
  `skills/generate-ui`, `ui/prompt.md`, and a top-level `manifest.json`
  — **not** `sky/`, `frontend/`, `backend/`, `datasource/` as an earlier
  draft implied. Its `produces[]` in the manifest is declarative-only
  (the backend does not emit new streams). It is a good example for
  paired frontend+backend TS/Py, not for `sky/` or `datasource/`. Log a
  follow-up if a real maximal example is wanted for `datasource/` +
  `sky/` coverage.
- Do not hand-author `<id>.zip`. Always go through `plugin pack` so the
  determinism guarantees from subtask 03 apply.
- If any legacy example depends on a feature we chose to drop, note it in
  the subtask's Execution Notes and open a follow-up rather than silently
  losing behaviour.

## Testing Strategy

**Targeted only.** Run:

```
pnpm exec pytest tests/test_plugin_catalog.py -q
```

Plus any per-plugin validate/pack invocations you perform locally. Full
suite is not required here.

## Execution Notes

Migrated 18 flat view YAMLs plus `pulse-ts` and `lan-pulse` into `plugins/src/<id>/` and packed each with `zoto-viz.py plugin pack`. Catalog zips **are** the views (`plugin:<id>` menu rows once subtask 11 strips hardcoded `MODES`). Arcade TS for Doom stays in `web/src/arcade/doom*.ts`; `plugins/src/doom/` is `plugin.yml` + `visualisation.yml` with `engine: doom` (maps to `arcadeId: doom` via `engineDispatch`).

### Dropped / follow-ups
- **lan-pulse `skills/generate-ui/`** — dropped. Unified v1 has no `skills/`. Follow-up if generate-UI returns.
- **lan-pulse `ui/prompt.md`** — dropped. Unified v1 has no `ui/` / generate-UI. Follow-up if prompt UI returns.
- **lan-pulse maximal example** — `produces[]`/`consumes[]` are declarative on `plugin.yml` (`datasource:`); no `datasource/collector.py` and no `sky/`. A real maximal example for collector + sky is still wanted.
- **pulse-ts Python** — `service/__init__.py` landed as `backend/service.py` (unified convention), not `backend/__init__.py`.
- **`docs/contributing.md` zlib/cross-machine pack caveat** — TODO left for subtask 10. CI check is `tests/test_plugin_catalog.py::test_pack_is_reproducible`.
- **`plugins.seed()`** — no-op. Home-dir copy from example YAML is gone; catalog is `plugins/*.zip`. Subtask 08 still owns legacy-home migration.

### Agent Session Info
- Agent: generalPurpose
- Started: 2026-09-15
- Completed: 2026-09-15

### Work Log
- Enumerated 20 plugins (18 YAML + pulse-ts + lan-pulse).
- Wrote source trees, `plugin validate` + `plugin pack` via CLI (never hand-authored zips).
- Added `tests/test_plugin_catalog.py` (catalog scan, doom arcadeId smoke, lan-pulse smoke, pack reproducibility).
- Retargeted tests/docs off `examples/plugins` and `examples/agent-plugins`.
- Deleted those example trees.

### Blockers Encountered
None.

### Files Modified
See status.yml artifacts.
