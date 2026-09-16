# Subtask: Catalog merge + gitignore

## Metadata
- **Subtask ID**: 01
- **Feature**: Src-Master Plugin Catalog
- **Assigned Subagent**: generalPurpose
- **Dependencies**: None
- **Created**: 20260916

## Objective

Make `plugins/src/<id>/` the default live catalog. Merge in gitignored
`plugins/*.zip` only when that id is not already a src tree. Collision is a
scan error (zip skipped, src row kept). Stop requiring a committed zip per
core plugin. Remove the on-disk first-party zips and the `cpu-pong` src
duplicate so a default scan is not a wall of errors.

## Deliverables Checklist

- [x] Change `service/plugins.py::scan` so **both** `scan()` (no args /
      `ZOTO_VIZ_REPO_ROOT`) **and** `scan(explicit_root)` are a **merge**
      whenever src trees are present:
      1. Resolve src dir + zips dir from the root:
         - `root is None` → `plugin_src_dir()` + `plugin_zips_dir()`
         - `root/plugins/src` exists → that src + `root/plugins/*.zip`
         - `root/src` exists (root is already a `plugins/` dir, as in
           today’s `scan(PLUGINS)`) → `root/src` + `root/*.zip`
      2. Load every src `plugin.yml` tree (same row shape as
         `_scan_trees`, including `parts` via `detect_parts`, compile,
         backend, sky artefacts). Catalog row includes `origin: "src"`.
      3. Then load matching `*.zip` via existing unpack-to-`.runtime/`
         path. Catalog row includes `origin: "zip"` and `zip: <path>`.
      4. If a zip’s `plugin.yml` id (or zip stem) is already in the src
         set, append `{"file": <zip path>, "error": "src catalog owns id '<id>'"}`
         (wording may match existing error style) and **do not** unpack or
         catalog that zip.
      5. Duplicate ids **within** src or **within** zips stay as today’s
         `duplicate plugin id` errors.
- [x] Keep the YAML/tree fallback: `scan(root)` on a directory with neither
      src `plugin.yml` trees nor `*.zip` still uses `_scan_trees` so
      existing tmp-yml tests (`tests/test_hooks.py`, loose YAML fixtures)
      keep working.
- [x] Frontend compile / Python hooks / sky GLSL for src rows read from
      the src tree directly (no mandatory unpack). Zip rows still unpack
      to `plugins/.runtime/<id>/`. Leftover `.runtime/<id>/` dirs from the
      old zip-only scan are unused for src rows (self-healing). Optionally
      omit deleting them; do not load src plugins from stale `.runtime`.
- [x] Update `.gitignore`: add `plugins/*.zip`. Keep `plugins/.runtime/`.
      Do **not** ignore `plugins/src/**` or `examples/plugins/**`.
- [x] Update `service/paths.py` docstrings: `plugin_zips_dir` is the local
      contrib drop zone (gitignored zips), not the committed catalog;
      `plugin_src_dir` is the shipped catalog.
- [x] Rewrite `tests/test_plugin_catalog.py` **before or atomically with**
      deleting on-disk zips (the current `assert zips` fails if zips go
      first):
      - Catalog is non-empty from **src** (no `assert zips` / zip-stem ==
        src-id equality).
      - `test_doom_view_wraps_arcade_id`,
        `test_lan_pulse_frontend_backend_declarative_datasource`, and
        `test_former_modes_are_menu_plugins` use the merge (`scan()` or
        `scan(PLUGINS)` — both must see src). They must not require
        `plugins/doom.zip` on disk.
      - Remove `test_pack_is_reproducible` from this file (subtask 04 owns
        byte-identity for `examples/plugins/sample.zip` only).
      - Add tests (tmp `ZOTO_VIZ_REPO_ROOT`): src-only row; zip-only row
        when no src; colliding zip → error + src row present + zip not in
        `plugins` list.
- [x] Delete untracked first-party `plugins/*.zip` from the working tree
      (they must not remain to collide with src after the merge).
- [x] Delete `plugins/src/cpu-pong/` (duplicate of `cpupong` with
      `id: cpupong`). Keep `plugins/src/cpupong/`.
- [x] Update `tests/test_paths.py::test_gitignore_runtime_not_zips_or_src`
      (rename as needed): `plugins/*.zip` **is** ignored; `plugins/src/**`
      and `examples/plugins/sample.zip` are **not** ignored.
- [x] `schema/plugin.schema.json` top-level `description` may still say
      “unified plugin zip”; leave wording to subtask 05. Do not change docs
      in this subtask. Do **not** rewrite frontend/sky/backend/cli/mcp
      tests here — that is subtask 02 / 03.

## Definition of Done

- [x] `plugins.scan()` with no args, on this checkout with **no**
      `plugins/*.zip`, returns every first-party src id (including `doom`
      and `lan-pulse`) and zero src/zip collision errors.
- [x] `scan(PLUGINS)` (explicit `plugins/` directory) also returns those
      src rows.
- [x] Targeted pytest: `tests/test_plugin_catalog.py` and
      `tests/test_paths.py` pass.
- [x] `git check-ignore -q plugins/example.zip` is true;
      `git check-ignore -q plugins/src/topology/plugin.yml` is false.
- [x] `plugins/src/cpu-pong/` is gone; `plugins/src/cpupong/` remains.
- [x] No linter errors in modified files.
- [x] Do **not** run the full pytest / vitest suite (subtask 05).

## Implementation Notes

- Today `_scan_roots(None)` is zip-only (`plugin_zips_dir` +
  `plugin_runtime_dir`). Replace that default with an explicit
  `_scan_catalog()` merge used for both `root is None` and explicit roots
  that contain src. Preserve `_scan_zips` for the zip half.
- Origin field: add `origin` on the catalog row (`"src"` | `"zip"`). Do not
  break clients that ignore unknown keys. Frontend that keys on `id` is
  unchanged.
- Consent / sha256 for src rows: hash the tree or `plugin.yml` as today for
  trees (`_plugin_sha`); zip rows keep zip sha256.
- Overlay (`overlay` / `mode_id`) is unchanged. This subtask does **not**
  implement plugin-on-plugin look overlay for colliding ids — collision is
  an error, not an overlay.
- Do not gitignore `examples/plugins/*.zip`.
- Do not implement `plugin pack -o` here (subtask 03). Existing `plugin pack`
  still writing `plugins/<id>.zip` is acceptable until 03; just do not leave
  those zips in the working tree when finishing 01.
- Other tests that still pack src+zip and `scan()` will fail until subtask
  02 / 03. Do not “fix” those files in this session.

## Testing Strategy

**IMPORTANT**: Do NOT trigger global test suites during parallel execution. Instead:

- Create targeted tests for files being modified
- Run tests only on directly affected files
- Defer full test suite execution to the final verification phase

## Execution Notes

Implemented src-first catalog merge in `service/plugins.py`. Default
`scan()` and `scan(explicit_root)` with a `plugins/src` (or `src` sibling)
layout load src trees with `origin: "src"`, then contrib zips with
`origin: "zip"`. Colliding zips append `src catalog owns id '<id>'` and
are neither unpacked nor catalogued. YAML/tree fallback is unchanged for
directories with neither src trees nor zips.

### Agent Session Info
- Agent: generalPurpose (subtask 01)
- Started: 2026-09-16T00:41:37Z
- Completed: 2026-09-16

### Work Log
- Added `_catalog_layout` / `_scan_catalog` / `_owned_src_ids`; `_scan_zips`
  takes `owned_ids` and skips unpack on collision.
- Src rows compile/hooks/sky from the src tree (`file` points at
  `plugins/src/<id>/plugin.yml`). Zip rows still unpack to `.runtime/<id>/`.
- `.gitignore`: `plugins/*.zip` (does not match `examples/plugins/*.zip`).
- `plugin_zips_dir` / `plugin_src_dir` docstrings updated.
- Rewrote `tests/test_plugin_catalog.py` (src catalog, merge fixtures,
  dropped `test_pack_is_reproducible`).
- Deleted 20 untracked `plugins/*.zip` and `plugins/src/cpu-pong/`.
- Targeted pytest: 19 passed (`test_plugin_catalog.py` + `test_paths.py`).
- `scan()` / `scan(PLUGINS)`: 20 src ids including doom and lan-pulse, 0
  collision errors.
- Did not run the full pytest/vitest suite. Did not commit. Did not change
  docs, schema description, or frontend/sky/backend/cli/mcp tests.

### Blockers Encountered
None.

### Files Modified
- modified: `service/plugins.py`, `service/paths.py`, `.gitignore`,
  `tests/test_plugin_catalog.py`, `tests/test_paths.py`, this subtask file
- deleted: `plugins/*.zip` (20 first-party zips), `plugins/src/cpu-pong/`

### Fix-list round (judge Failed → respawn)
- Gap: a parallel writer restored untracked `plugins/src/cpu-pong/`
  (id `cpupong`, mtime 2026-09-16T00:53:02Z) during the first judge pass.
- Re-deleted `plugins/src/cpu-pong/` at 2026-09-16T03:25Z. `plugins/src/cpupong/`
  kept. Re-checked after 6s and after targeted pytest: still gone.
- `scan()` / `scan(PLUGINS)`: 20 src ids, 0 errors (no `duplicate plugin id
  'cpupong'`, no src/zip collisions).
- Targeted pytest `--no-cov`: 20 passed
  (`tests/test_plugin_catalog.py` + `tests/test_paths.py`).
- Writer hunt: no live `lsof` holder; no other agent transcript contains a
  Write of `plugins/src/cpu-pong/`. Restore likely Cursor editor/local-history
  of untracked files the first 01 session had read. No writer recreated the
  tree after this delete.
- Did not start Phase 2. Did not commit. Did not run the full suite.

