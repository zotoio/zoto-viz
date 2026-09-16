# Subtask: Schema + Zip Contract

## Metadata
- **Subtask ID**: 01
- **Feature**: Unified Plugin Zips
- **Assigned Subagent**: generalPurpose
- **Dependencies**: None
- **Created**: 20260915

## Objective

Author the single JSON Schema (`schema/plugin.schema.json`) that governs
the new unified plugin format and freeze the on-disk zip contract (member
prefixes, allowed suffixes, size limits). Supersede the two existing
schemas (`schema/view-plugin.schema.json`,
`schema/agent-plugin.schema.json`) so downstream subtasks have one target.

## Deliverables Checklist

- [x] `schema/plugin.schema.json` — top-level schema for `plugin.yml` with
      `$defs` (or sibling sub-schemas) for `visualisation.yml`, `sky.yml`,
      and `streams.yml`. `plugin.yml` requires only `id`, `name`, `version`.
      Optional keys: `description`, `entry` hints (e.g. `frontend.entry`,
      `backend.entry`), `capabilities` (frontend allowlist), `overlay` /
      `mode_id`, `datasource.consumes[]`, `datasource.produces[]`.
- [x] Sub-schemas cover:
  - `visualisation.yml` — `engine`, `base`, `look`, `style`, `layout`,
    `options`, `config`. Keep `look` (and `style`, `layout`, `options`,
    `config`) as free-form maps with `additionalProperties: true`:
    do **not** enumerate specific look keys in the schema itself. The
    old view-plugin schema kept `look` open for the same reason —
    `web/src/core/modes.ts` grows one-off knobs (`graphBase`,
    `arcadeId`, theme cycle flags, etc.) faster than a JSON Schema can
    track. Grep `web/src/core/modes.ts` and `web/src/core/themes.ts`
    once and note the keys that actually exist today in the JSON
    Schema `description` so plugin authors have a hint, but do **not**
    add them to `required`. A separate cross-check: fields such as
    `chromatic`, `film_noise`, `film_flicker`, `halo`, `drop_amount`,
    `cursor_pulse`, `aim_size`, `target_size`, `scanline`,
    `follow_zoom_curve/max/min` are **not** present in the current
    codebase — the schema must not gate on them.
  - `sky.yml` — optional `recipe`, `pins`, notes for both AI-generated
    and hand-authored skies. Keep additive; do not lock in shape.
  - `streams.yml` — `consumes[]` (monitor stream names + optional field
    remaps), `produces[]` (new stream names the collector emits), plus
    frontend-visible bindings.
  - **Plugin shader uniform contract** (referenced by subtask 07):
    document the frozen uniform subset a `sky/fragment.glsl` may read.
    Recommended subset: `uTime` (float), `uOpacity` (float), `uBright`
    (float), `uAudio` (float), `uAccent` (vec3), `uBg` (vec3). Explicitly
    **exclude** `uMode` (shipped-enum index — implementation-specific)
    and the sky-recipe uniforms `uMotif / uA / uB / uWarp / uGrain /
    uBands` (AI Dynamic's private state). The schema captures the
    contract as a top-level `description` block or a `$defs/shader`
    entry — subtask 07 enforces it at compile time.
- [x] Freeze the zip contract in a short `README.md` fragment (embedded
      into `docs/plugins.md` by subtask 10) covering:
  - required member: `plugin.yml` at the archive root
  - optional roots: `visualisation.yml`, `frontend/**`, `sky/sky.yml`,
    `sky/fragment.glsl`, `datasource/streams.yml`,
    `datasource/collector.py`, `backend/service.py`
  - allowed member suffixes (superset from `service/agent_plugins.py`
    plus `.glsl`): `.yml .yaml .json .py .ts .tsx .js .mjs .css .html .md
    .txt .svg .png .jpg .jpeg .webp .gif .glsl`
  - size limits: 1.5 MB compressed, 4 MB uncompressed, ≤ 80 files
  - hard rejects: absolute paths, `..` traversal, symlinks
- [x] Add a doc block (a top-level `description` in the JSON Schema is
      fine) enumerating the folder layout so validators can produce
      actionable error messages.
- [x] Update `web/schema/*` references if the schema is copied there for
      TS type generation (grep for `view-plugin.schema.json` to catch any
      importers).
- [x] Delete `schema/view-plugin.schema.json` and
      `schema/agent-plugin.schema.json`, **or** replace their contents with
      a one-line `$ref` shim pointing to `plugin.schema.json` (subtask 10
      is responsible for removing shims). Note the choice in the "Execution
      Notes" section of the subtask.
- [x] Add or update `tests/test_plugin_schema.py` to load
      `schema/plugin.schema.json` and validate a minimal fixture (only
      `plugin.yml` with id/name/version) plus a maximal fixture covering
      every optional part.
- [x] Add a test case that the shader uniform contract lives in the
      schema (grep the JSON Schema for the whitelisted uniform names +
      the explicit `uMode` exclusion). Subtask 07 consumes this contract.

## Definition of Done

- [x] `schema/plugin.schema.json` exists and passes `jsonschema` self-check.
- [x] Minimal fixture (`plugin.yml` with id/name/version only) validates.
- [x] Maximal fixture (plugin.yml + visualisation.yml + sky.yml +
      streams.yml + placeholders for the folders) validates.
- [x] Invalid fixtures (missing `id`, wrong `version` type, disallowed
      member suffix in a zip listing) are rejected with clear errors.
- [x] Old schemas either deleted or shimmed; a follow-up TODO for shim
      deletion is filed against subtask 10.
- [x] `pnpm exec pytest tests/test_plugin_schema.py -q` passes.
- [x] No linter errors in modified files (`ruff`/`pyright` for Python,
      `pnpm --filter web tsc --noEmit` if TS types were regenerated).

## Implementation Notes

- Study `schema/view-plugin.schema.json` and
  `schema/agent-plugin.schema.json` before drafting: keep every field they
  already validate that is still meaningful in the unified format.
- `plugin.yml` should keep the existing `capabilities` model from the
  agent-plugin schema (frontend permission allowlist) so subtask 05 can
  reuse it verbatim.
- Prefer `additionalProperties: false` where reasonable but keep
  `options`, `config`, and `look` as free-form maps — `web/src/core/modes.ts`
  demonstrates how many one-off knobs live there.
- Reference `service/agent_plugins.py` for the zip-safety constants
  (`MAX_ZIP_BYTES`, `MAX_UNCOMPRESSED_BYTES`, `MAX_FILES`, allowed suffix
  set). Move them into a shared module in subtask 03.
- The doom WIP (`examples/plugins/doom.yml`) uses novel `engine: doom`
  values; keep `engine` open (enum with a fallback) so the WIP still
  validates.

## Testing Strategy

**Targeted only.** Run `pnpm exec pytest tests/test_plugin_schema.py -q`.
Do **not** run the full pytest suite or the vitest suite during parallel
execution — that is reserved for the final verification phase.

If a shim path is chosen for the old schemas, add a one-liner test that
loads each shim and confirms it forwards to `plugin.schema.json`.

## Execution Notes

Shim choice: **one-line `$ref`** (`{ "$ref": "plugin.schema.json" }`) for
`schema/view-plugin.schema.json` and `schema/agent-plugin.schema.json`.
Not deleted, so `service/plugins.py` and `service/agent_plugins.py` keep
their `SCHEMA_FILE` paths. Follow-up: subtask 10 already lists “Delete
the old schemas if subtask 01 left shims” — that is the shim-deletion TODO.

`plugin.yml` remains id/name/version-only as required. Optional
visualisation keys and legacy agent-plugin keys (`produces`/`consumes`/
`scripts`/`ui`/`skills`) stay on the top-level document so current YAML
and `lan-pulse` `manifest.json` still validate through the shims. `look` /
`style` / `layout` / `options` / `config` are free-form
(`additionalProperties: true`); look keys from `PluginLook` / `modes.ts` /
`themes.ts` are hints in the description only. `engine` is an open string
(doom WIP validates). Shader contract lives in the top-level description
and `$defs/shader`. Zip contract is `$defs/zipListing` +
`schema/plugin-zip-contract.md`.

No `web/schema/` copy exists; grep for `view-plugin.schema.json` found
importers only in service/docs/tests/specs. No TS types regenerated.

### Agent Session Info
- Agent: generalPurpose
- Started: 2026-09-15T06:54:54.758Z
- Completed: 2026-09-15T07:09:25.009Z

### Work Log
- Heartbeat in_progress; authored `schema/plugin.schema.json`.
- Replaced the two legacy schemas with `$ref` shims; added
  `plugins.deref_schema` so runtime validators follow the shim.
- Added `schema/plugin-zip-contract.md` and `tests/test_plugin_schema.py`.
- Targeted tests: `.venv/bin/python3 -m pytest tests/test_plugin_schema.py -q -o addopts=` → 12 passed.
  (Repo `pnpm exec` is Yarn; pytest.ini `--cov-*` needs pytest-cov, so addopts overridden.)
- `ruff check` clean on touched Python. Did not `ruff format` the dirty
  WIP `service/plugins.py` / `service/agent_plugins.py` bodies.

### Blockers Encountered
None.

### Files Modified
- created: `schema/plugin.schema.json`
- created: `schema/plugin-zip-contract.md`
- created: `tests/test_plugin_schema.py`
- modified: `schema/view-plugin.schema.json` (shim)
- modified: `schema/agent-plugin.schema.json` (shim)
- modified: `service/plugins.py` (`deref_schema`)
- modified: `service/agent_plugins.py` (follow shim)
- modified: this subtask file (checklist + notes)
