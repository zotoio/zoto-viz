# Subtask: CLI pack destination + MCP/add src refuse

## Metadata
- **Subtask ID**: 03
- **Feature**: Src-Master Plugin Catalog
- **Assigned Subagent**: generalPurpose
- **Dependencies**: 01
- **Created**: 20260916

## Objective

Stop `plugin pack` from writing into the live contrib drop zone (that would
collide with src). Make pack a **share** command (`dist/<id>.zip` or `-o`).
Make `plugin add` and MCP `install_plugin_zip` hard-refuse ids that already
exist under `plugins/src/`. Retarget dirty-tree and migration copy hints so
nobody is told to pack-and-commit a catalog zip.

## Deliverables Checklist

- [x] `cli_pack` (`service/plugins.py` / `zoto-viz.py plugin pack`):
      - `plugin pack <id-or-src-dir> [-o PATH]`
      - Default dest is `dist/<id>.zip` under `repo_root()` (create `dist/`
        as needed).
      - `-o` / `--output` writes that path instead.
      - Still runs schema + zip-safety via existing `pack_tree`.
      - Does **not** write `plugins/<id>.zip`.
- [x] `.gitignore`: add `dist/` (in addition to subtask 01’s
      `plugins/*.zip`).
- [x] `cli_add`: if `plugins/src/<id>/plugin.yml` (or `.yaml`) exists,
      refuse with a non-zero exit and a message that src owns that id.
      `--force` does **not** override a src collision. `--force` still
      overwrites an existing **zip** when there is no src tree.
- [x] MCP `install_plugin_zip` (`service/mcp.py`):
      - Same hard refuse when src exists (even with `force: true`).
      - Existing zip + no `overwrite` still errors.
      - Same sha256 as existing zip → unpack only, unchanged.
      - Still never `git add` / `git commit`.
- [x] `plugin_migration.dirty_tree_paths`: stop treating
      `plugins/<id>.zip` as a git-tracked catalog path. Gitignored zips
      must not fail-closed as “dirty catalog”. Keep fail-closed behaviour
      for uncommitted `plugins/src/<id>/` if MCP would still consult
      dirty-tree **after** the src-exists refuse (if src exists, refuse
      first and skip dirty-tree). Runtime cache
      `plugins/.runtime/<id>/` stays gitignored; do not require it to be
      clean. Update `tests/test_mcp.py` / `tests/test_plugin_migration.py`
      accordingly (split any src+zip-then-scan fixtures in those files).
- [x] `plugin_migration.MIGRATE_HINT` and the console line: src is live;
      do **not** say `plugin pack … to commit`. Example:
      `[plugin-migrate] <id> copied to plugins/src/<id>/ — it is live in the catalog`.
      Agent draft (`service/agent.py` hint, docs owned by subtask 05) should
      point at src being live and `plugin pack -o` only to share a zip.
- [x] `catalog_ids()` already treats src **or** zip as present; keep that
      so migration does not copy over a first-party src id. A leftover
      home plugin whose id matches a shipped src id stays uncopied.
- [x] Tests (tmp repo):
      - `plugin pack sample` creates `dist/sample.zip`, not
        `plugins/sample.zip`.
      - `plugin pack sample -o /tmp/x.zip` writes that file.
      - `plugin add` of a zip whose id has a src tree exits non-zero.
      - MCP install of a src-owned id returns an error payload; `force`
        does not write.
      - MCP install of a new id still writes `plugins/<id>.zip` and
        unpacks `.runtime`.
      - Migration message has no `plugin pack` commit instruction.

## Definition of Done

- [x] Packing a src plugin does not create a file that default `scan()`
      treats as a collision.
- [x] Contrib install (`add` / MCP) cannot replace a shipped src id.
- [x] Migration / draft hints no longer tell the operator to pack in order
      to commit.
- [x] Targeted pytest for `tests/test_plugin_cli.py`, `tests/test_mcp.py`,
      `tests/test_plugin_migration.py`, `tests/test_agent.py` (hint string)
      as touched, all pass.
- [x] No linter errors in modified files.
- [x] Do **not** rewrite docs (subtask 05) and do **not** run the full
      suite.

## Implementation Notes

- argparse: add `-o/--output` on the `pack` subparser. Keep `plugin zip` as
  the deprecated alias of `add` (unchanged).
- Dist path: `paths.repo_root() / "dist" / f"{pid}.zip"`. A small
  `plugin_dist_dir()` helper is optional; do not invent a second catalog
  root.
- Force vs src: document in the CLI help string that `--force` overwrites
  zips, not src trees.
- Dirty-tree previously existed because MCP wrote git-tracked zips. After
  01 those zips are gitignored, so porcelain on `plugins/<id>.zip` is
  noise. The remaining useful refuse is **src owns id**.
- Agent `POST /api/ai/plugin` already writes `plugins/src/<id>/` and does
  not pack — that is now the correct live path. Only the hint string
  changes here.
- May run in parallel with subtask 02. Do not edit
  `tests/test_plugin_frontend.py`, `tests/test_plugin_sky.py`,
  `tests/test_plugin_backend.py`, or `tests/test_plugins.py`.

## Testing Strategy

**IMPORTANT**: Do NOT trigger global test suites during parallel execution. Instead:

- Create targeted tests for files being modified
- Run tests only on directly affected files
- Defer full test suite execution to the final verification phase

## Execution Notes

Pack is a share command (`dist/<id>.zip` or `-o`). `plugin add` and MCP
`install_plugin_zip` hard-refuse src-owned ids even with force. Gitignored
zips are not dirty catalog. Migration/agent hints say src is live.

### Agent Session Info
- Agent: generalPurpose
- Started: 2026-09-16T03:35:02Z
- Completed: 2026-09-16T03:41:01Z

### Work Log
- `cli_pack` writes `repo_root()/dist/<id>.zip`; `-o/--output` overrides.
  Does not write `plugins/<id>.zip`. `pack_tree` still validates schema + zip safety.
- `.gitignore` adds `dist/` after existing `plugins/*.zip`.
- `cli_add` / MCP refuse when `plugins/src/<id>/plugin.yml` (or `.yaml`) exists;
  `--force` / `force: true` does not override. `--force` still overwrites a zip
  when there is no src tree. Same-sha MCP install unpacks only. Never git-add.
- `dirty_tree_paths` only porcelain-scans `plugins/src/<id>/`. Gitignored
  `plugins/<id>.zip` and `.runtime` are not dirty catalog. MCP src-owns refuse
  runs first and skips dirty-tree.
- `MIGRATE_HINT` = "it is live in the catalog". Agent draft hint: src is live;
  `plugin pack -o` only to share.
- `catalog_ids()` still src or zip; leftover home matching src stays uncopied.
- Targeted pytest `-o addopts=`: 58 passed
  (`tests/test_plugin_cli.py`, `tests/test_mcp.py`,
  `tests/test_plugin_migration.py`, `tests/test_agent.py`).
- Did not rewrite docs. Did not run the full suite. Did not commit.

### Blockers Encountered
None.

### Files Modified
- `.gitignore`
- `service/plugins.py`
- `service/mcp.py`
- `service/plugin_migration.py`
- `service/agent.py`
- `tests/test_plugin_cli.py`
- `tests/test_mcp.py`
- `tests/test_plugin_migration.py`
- `tests/test_agent.py`
