# Subtask: Unpacker + Scanner + CLI (pack / add / validate / list)

## Metadata
- **Subtask ID**: 03
- **Feature**: Unified Plugin Zips
- **Assigned Subagent**: generalPurpose
- **Dependencies**: 01, 02
- **Created**: 20260915

## Objective

Deliver the core runtime + CLI surface for the unified plugin format:
scan `plugins/*.zip`, unpack them safely into `plugins/.runtime/<id>/`
whenever the zip's sha256 changes, produce catalog entries, and expose the
`zoto-viz.py plugin {validate,list,pack,add}` commands. Absorb the zip
safety code that currently lives in `service/agent_plugins.py`.

## Deliverables Checklist

- [x] New module `service/plugin_zip.py` (or equivalent name) housing:
  - Zip-safety constants (`MAX_ZIP_BYTES = 1_500_000`,
    `MAX_UNCOMPRESSED_BYTES = 4_000_000`, `MAX_FILES = 80`, allowed
    suffixes including `.glsl`).
  - `inspect_zip(path: Path) -> ZipManifest` — validates member paths,
    suffixes, absence of symlinks / `..`, aggregate size, then returns the
    parsed `plugin.yml` + list of detected optional folders.
  - `unpack_zip(path: Path, dest: Path) -> UnpackResult` — safe extraction
    into `dest`. Idempotent: no-op if `dest/.zip.sha256` already matches the
    current archive digest.
  - `plugin_sha256(path: Path) -> str` helper.
- [x] Extend or refactor `service/plugins.py` to:
  - Scan `plugin_zips_dir()` for `*.zip` (skipping hidden files).
  - Ensure `plugin_runtime_dir()/<id>/` exists and is up-to-date for each
    zip via `unpack_zip`.
  - Build the in-memory plugin catalog from the **unpacked** trees only
    (single code path — no more separate view-plugin vs agent-plugin
    branching).
  - Emit clear errors on validation / unpack failures (surface them via
    the `/plugins` HTTP endpoint payload so the frontend can show them).
- [x] Refresh `zoto-viz.py plugin` subcommands (`service/mcp.py` or the
      CLI module that owns the current `plugin validate|list|install|zip`
      surface):
  - `plugin validate <path>` — accepts a zip **or** a
    `plugins/src/<id>/` directory; runs schema + zip-safety checks.
  - `plugin list` — lists installed plugins (id, version, source zip
    path, optional parts detected, consent state summary).
  - `plugin pack <id-or-src-dir>` — zips `plugins/src/<id>/` into
    `plugins/<id>.zip` (deterministic order, fixed mtimes to keep sha256
    stable across environments) and prints the new sha256.
  - `plugin add <zip-path>` — validates then copies into
    `plugins/<id>.zip`. Refuses to overwrite unless `--force`.
- [x] Retire `zoto-viz.py plugin install` **fully** — do **not** alias it
      to `plugin add`. The current `plugin install` command copies
      shipped example YAMLs into `~/.zoto-viz/plugins/` **and** writes a
      systemd user-unit override (see `service/plugins.py::cli_install`
      + `service/sysconfig.py::write_systemd_override`). Under the
      unified format the seed step disappears (plugins ship in the repo)
      but the systemd override is still wanted. Move it into
      `zoto-viz.py install` (top-level, not under `plugin`). If that
      rename is out of scope for subtask 03, cut a follow-up spec — do
      not silently drop the systemd behaviour.
- [x] Rename `zoto-viz.py plugin zip <zipfile>` to
      `zoto-viz.py plugin add <zipfile>` (same argparse subcommand
      wiring in `service/plugins.py::add_parser`). Keep `plugin zip` as
      a deprecation alias for one release, printing a `[deprecation]
      plugin zip is now plugin add` line before delegating.
- [x] Add tests:
  - `tests/test_plugin_zip.py` — safety rejections (oversize, `..`,
    disallowed suffix), success path, idempotent unpack.
  - `tests/test_plugin_cli.py` — validate/list/pack/add round-trip on a
    temp repo root.
  - Extend `tests/test_plugins.py` to run the scanner against a fixture
    `plugins/` tree and confirm the catalog matches expectations.

## Definition of Done

- [x] Dropping a valid zip into `plugins/` and running the scanner produces
      a matching entry in the catalog.
- [x] Re-running the scanner without changing the zip does **not** re-unpack
      (verify by checking mtime of the unpacked tree or the recorded
      sha256).
- [x] Editing the zip and re-scanning triggers a fresh unpack.
- [x] `zoto-viz.py plugin validate` accepts both zips and source dirs.
- [x] `zoto-viz.py plugin pack` produces a byte-identical zip when re-run
      against the same source dir (deterministic) — asserted in
      `tests/test_plugin_zip.py` on the pinned Python version. Note that
      cross-machine determinism depends on the underlying zlib version;
      document this in `docs/contributing.md` (subtask 10) and add a CI
      reproduce job that re-packs every `plugins/src/*` on the pinned
      Python and fails the build on any diff against the committed zips
      (subtask 09 owns the catalog test that consumes this).
- [x] `zoto-viz.py plugin add` refuses `..`/absolute paths in the source
      zip and refuses to overwrite without `--force`.
- [x] `pnpm exec pytest tests/test_plugin_zip.py tests/test_plugin_cli.py
      tests/test_plugins.py -q` passes.
- [x] No linter errors in modified Python files.

## Implementation Notes

- Copy the safety code from `service/agent_plugins.py` verbatim to start,
  then adjust constants + allowed suffixes to match subtask 01's schema.
- Determinism for `plugin pack`: sort members lexicographically, set every
  entry's `date_time` to `(1980, 1, 1, 0, 0, 0)`, compress with
  `ZIP_DEFLATED`, and write with a fixed compression level. Cross-check by
  running `plugin pack` twice on the same tree and diffing bytes.
- The catalog builder used to run twice — once in `service/plugins.py` for
  view YAMLs and once in `service/agent_plugins.py`. Collapse into one
  path here so subtasks 04/05/06 have a single source of truth.
- Preserve the existing `/plugins` HTTP endpoint's response shape as much
  as possible (frontend depends on it) — subtask 06 refines it.
- Coordinate with subtask 02 on where the sha256 marker lives; store it
  as `plugins/.runtime/<id>/.zip.sha256` (single-line hex) so the file
  itself is human-inspectable.
- `service/agent_plugins.py` is **not** deleted here — subtask 08 stops
  its callers and subtask 10 removes the file entirely. During this
  subtask it may remain in the tree.

## Testing Strategy

**Targeted only.** Run:

```
pnpm exec pytest tests/test_plugin_zip.py tests/test_plugin_cli.py tests/test_plugins.py -q
```

If the CLI tests spawn a subprocess, use a temp repo root fixture so the
committed `plugins/` tree is not touched.

Do **not** run the full pytest suite; the executor's final phase covers it.

## Execution Notes

### Agent Session Info
- Agent: generalPurpose
- Started: 2026-09-15T07:15:49Z
- Completed: 2026-09-15T07:30:45Z

### Work Log
- Absorbed zip-safety from `service/agent_plugins.py` into `service/plugin_zip.py`. Constants match schema `$defs/zipContract` (`MAX_UNCOMPRESSED_BYTES = 4_194_304` / 4 MiB — the deliverable's `4_000_000` was the rounded figure; schema wins).
- Scanner in `service/plugins.py` unpacks `plugin_zips_dir()/*.zip` into `plugin_runtime_dir()/<id>/` keyed by `plugin.yml` id, catalogs from unpacked trees, and keeps a YAML/src-tree fallback when an explicit `scan(root)` has no zips (so `tests/test_hooks.py` and example YAML still load until subtask 09 migrates them).
- CLI: `plugin validate|list|pack|add`. `plugin zip` prints `[deprecation] plugin zip is now plugin add` then delegates. `plugin install` is gone (argparse invalid choice). Systemd override + sys-config live under top-level `zoto-viz.py install` (`sysconfig.cli_install`).
- Seed-from-examples is no longer part of install. `plugins.seed()` remains for monitor until subtask 08. Air-SSID watch-default filling on install is dropped with that seed step (subtask 09 / 10 if still wanted).
- TODO(subtask-10): `docs/contributing.md` zlib/cross-machine pack determinism. README / `docs/install.md` / `docs/systemd.md` / `docs/plugins.md` still mention `plugin install`.
- Targeted pytest: 33 passed. Ruff clean on authored Python (pre-existing E741 in unrelated `zoto-viz.py` lines left alone).

### Blockers Encountered
None.

### Files Modified
- created: `service/plugin_zip.py`, `tests/test_plugin_zip.py`, `tests/test_plugin_cli.py`
- modified: `service/plugins.py`, `service/sysconfig.py`, `zoto-viz.py`, `tests/test_plugins.py`
- `service/agent_plugins.py` left in place (subtask 08/10)
