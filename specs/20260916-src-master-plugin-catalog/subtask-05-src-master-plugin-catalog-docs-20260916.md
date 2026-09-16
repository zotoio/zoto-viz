# Subtask: Docs + full suite

## Metadata
- **Subtask ID**: 05
- **Feature**: Src-Master Plugin Catalog
- **Assigned Subagent**: generalPurpose
- **Dependencies**: 02, 03, 04
- **Created**: 20260916

## Objective

Rewrite operator/contributor docs so src is the shipped catalog, zip is the
contrib interchange format, pack is for sharing, and the all-features sample
lives under `examples/plugins/`. Run the full pytest + vitest suites. npm is
not a plugin distribution channel — do not add it.

## Deliverables Checklist

- [ ] `docs/plugins.md` — catalog is `plugins/src/<id>/`; zips are local
      contrib (`plugin add` / drop into `plugins/` / MCP); colliding zip is
      a scan error; sample fixture pointer; pack `-o` / `dist/`; remove
      “committed zip” / “git add plugins/<id>.zip”. Embed or point at
      `schema/plugin-zip-contract.md` as the **contrib** layout.
- [ ] `docs/contributing.md` — edit src → validate → (optional)
      `plugin pack -o` to share. `git add plugins/src/<id>/` only. Pack
      reproducibility is **only** `examples/plugins/sample.zip` (core
      plugins are src-canonical; zlib drift on first-party zips is not
      gated).
- [ ] `docs/install.md` — shipped views are src trees; unpack cache is
      still `.runtime` for **zip** contribs; migrate copies into src and
      is live (no pack-to-commit).
- [ ] `docs/api.md` — `GET /api/plugins` payload is the merge; MCP writes
      gitignored `plugins/<id>.zip` and refuses src ids; draft writes src
      and is live.
- [ ] `docs/agent.md` — draft hint: src is live; share with `plugin pack -o`.
- [ ] `docs/plugins-ts.md` — authoring under `plugins/src/<id>/` is live
      (no pack step to see the iframe).
- [ ] `README.md` — catalog line matches src-as-master.
- [ ] `schema/plugin.schema.json` top-level `description` and
      `schema/plugin-zip-contract.md` — zip is the interchange / contrib
      format; first-party trees are `plugins/src/<id>/`.
- [ ] `zoto-viz.py` module docstring / `plugin` help strings if they still
      say the catalog is `plugins/*.zip`.
- [ ] Grep the repo (docs, README, comments in `service/plugin_zip.py`,
      `service/plugins.py` headers) for “committed zip”, “git add
      plugins/<id>.zip”, and “pack … to commit”; retarget or delete.
- [ ] Do **not** mention npm as a way to install or publish plugins.
- [ ] Run full `pytest` and `web` vitest; fix regressions caused by this
      spec (do not expand scope).

## Definition of Done

- [ ] A contributor following `docs/contributing.md` never commits a
      first-party zip.
- [ ] Zip contract docs still describe members, suffixes, size limits, and
      hard rejects.
- [ ] Sample fixture is linked from plugins docs.
- [ ] `pytest` (repo) and `pnpm --dir web test` (or project-equivalent
      vitest) pass.
- [ ] No linter errors in modified files.

## Implementation Notes

- VitePress docs live under `docs/`. Keep tone consistent with the current
  pages; do not add a new top-level guide unless a stub already exists.
- Subtask 01–04 own behaviour. This subtask is wording + the full suite.
  If the suite finds a scanner/CLI bug, fix it here only when it is a
  leftover from 01–04; do not add features.
- Browser verification is not required (docs + catalog behaviour covered
  by pytest).

## Testing Strategy

This is the final verification phase. Run the full pytest suite and the
web vitest suite. Do not skip tests to go green; fix leftovers from 01–04.

## Execution Notes

Rewrote operator/contributor docs so src is the shipped catalog and zip is
contrib interchange. Full pytest (279 passed) and web vitest (176 passed)
are green. No leftover scanner/CLI bugs from 01–04. No npm plugin path
added. No git commit.

### Agent Session Info
- Agent: generalPurpose (subtask 05)
- Started: 2026-09-16T03:46:45.952Z
- Completed: 2026-09-16T03:50:00Z (approx)

### Work Log
- Rewrote `docs/plugins.md`: src catalog, colliding zip is a scan error,
  sample fixture pointer, `plugin pack` → `dist/` or `-o`, MCP gitignored
  zip + `src_owns_id`, draft/migrate live-from-src.
- Rewrote `docs/contributing.md`: `git add plugins/src/<id>/` only; pack
  identity gated on `examples/plugins/sample.zip` only.
- Updated install / api / agent / plugins-ts / README / schema description
  / zip-contract / `zoto-viz` plugin help / `plugins.add_parser` help /
  `plugin_zip.py` header.
- Grep (docs, README, `plugin_zip.py`, `plugins.py` headers): no
  “committed zip”, “git add plugins/<id>.zip”, or “pack … to commit”.
- `.venv/bin/python -m pytest`: 279 passed (21.34s), coverage 88.63%.
- `pnpm --dir web test`: 176 passed / 39 files (12.88s).
- No linter errors on modified files. No suite leftovers to fix.

### Blockers Encountered
None.

### Files Modified
- `docs/plugins.md`
- `docs/contributing.md`
- `docs/install.md`
- `docs/api.md`
- `docs/agent.md`
- `docs/plugins-ts.md`
- `README.md`
- `schema/plugin.schema.json`
- `schema/plugin-zip-contract.md`
- `zoto-viz`
- `service/plugins.py`
- `service/plugin_zip.py`
- this subtask file (Execution Notes)
- `specs/.../status/subtask-05-*.status.{yml,md}`
