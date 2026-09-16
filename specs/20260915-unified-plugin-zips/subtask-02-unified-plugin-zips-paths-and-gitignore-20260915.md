# Subtask: Paths + Gitignore

## Metadata
- **Subtask ID**: 02
- **Feature**: Unified Plugin Zips
- **Assigned Subagent**: generalPurpose
- **Dependencies**: None
- **Created**: 20260915

## Objective

Wire the on-disk paths for the unified plugin catalog: a committed
`plugins/` directory at the repo root, an editable `plugins/src/<id>/`
source tree, and a gitignored `plugins/.runtime/<id>/` unpack cache. Add
accessors in `service/paths.py` and stop the legacy directories in
`~/.zoto-viz/` from being touched at startup.

## Deliverables Checklist

- [x] Create `plugins/` directory at the repo root, initially containing a
      `.gitkeep` (subtask 09 fills it with migrated zips). Also create
      `plugins/src/.gitkeep`.
- [x] Update `.gitignore`:
  - add `plugins/.runtime/`
  - ensure nothing under `plugins/*.zip` or `plugins/src/**` is ignored.
- [x] Extend `service/paths.py` with:
  - `plugin_zips_dir(repo_root: Path | None = None) -> Path` — resolves
    to `<repo_root>/plugins`.
  - `plugin_src_dir(repo_root: Path | None = None) -> Path` —
    `<repo_root>/plugins/src`.
  - `plugin_runtime_dir(repo_root: Path | None = None) -> Path` —
    `<repo_root>/plugins/.runtime`.
  - `repo_root() -> Path` detection helper: 1) if
    `ZOTO_VIZ_REPO_ROOT` is set, use it verbatim (expanded and
    resolved); 2) else walk parents of `service/paths.py` until a
    `pyproject.toml` or `.git` sentinel is found; 3) else raise
    `RuntimeError("cannot locate zoto-viz repo root — set
    ZOTO_VIZ_REPO_ROOT")`. Do **not** silently fall back to `/plugins`
    or `~/plugins` — a wrong root is worse than a loud failure.
- [x] Wire `ZOTO_VIZ_REPO_ROOT` into the systemd override that
      `service/sysconfig.py::write_systemd_override` writes: add an
      `Environment=ZOTO_VIZ_REPO_ROOT=<abs>` line so the user unit sees
      the checkout regardless of its working directory. Absolute path is
      resolved when the override is written (not at unit-load time).
- [x] Document the detection order + systemd wiring in `docs/install.md`
      (subtask 10 owns the doc rewrite, but leave a TODO comment near
      the helper if the docs are already merged).
- [x] Remove/guard existing `mkdir(parents=True, exist_ok=True)` calls
      that create `~/.zoto-viz/plugins` and `~/.zoto-viz/agent-plugins` at
      startup. Grep `service/paths.py`, `service/plugins.py`,
      `service/agent_plugins.py`, `service/mcp.py`, `zoto-viz.py`.
- [x] Keep `~/.zoto-viz/plugin-consent.yml` handling exactly as-is — it is
      still the consent store.
- [x] Add `tests/test_paths.py::test_plugin_dirs_resolve` (or extend the
      existing paths test) to assert the three helpers resolve under the
      repo root and that repo-root detection is stable when called from
      subdirectories.

## Definition of Done

- [x] `plugins/`, `plugins/src/`, and `plugins/.runtime/` all resolve to
      the repo root at runtime — under the checkout **and** under the
      installed systemd user unit (via `ZOTO_VIZ_REPO_ROOT`).
- [x] Repo-root detection raises a clear `RuntimeError` when neither
      `ZOTO_VIZ_REPO_ROOT` nor a sentinel is available (test asserts on
      the message).
- [x] Fresh systemd override written by `sysconfig.write_systemd_override`
      contains `Environment=ZOTO_VIZ_REPO_ROOT=<abs>`.
- [x] `.gitignore` ignores `plugins/.runtime/` but not `plugins/*.zip` or
      `plugins/src/**`.
- [x] Starting `service/monitor.py` or `service/mcp.py` no longer creates
      `~/.zoto-viz/plugins` or `~/.zoto-viz/agent-plugins`.
- [x] Consent file access under `~/.zoto-viz/` is unchanged.
- [x] Targeted pytest for `tests/test_paths.py` passes.

## Implementation Notes

- Repo-root detection should be tolerant of `zoto-viz.py` being executed
  from any subdirectory and of test fixtures pointing at temporary trees.
  Follow whatever convention `service/paths.py` already uses; if none
  exists, prefer environment variable override (`ZOTO_VIZ_REPO_ROOT`) with
  a walk-up fallback.
- Leave the `ZOTO_VIZ_PLUGIN_SERVICE` env flag alone; it belongs to
  subtask 04.
- Do **not** touch consent code; subtask 07 will extend the stamp to
  include shader hash, and subtask 04 already relies on the existing shape.

## Testing Strategy

**Targeted only.** Run `pnpm exec pytest tests/test_paths.py -q` (or the
new module you author). Do not trigger the full suite.

## Execution Notes

Wired repo-root plugin catalog paths (`plugins/`, `plugins/src/`, gitignored
`plugins/.runtime/`), accessors in `service/paths.py`, and
`Environment=ZOTO_VIZ_REPO_ROOT=<abs>` in the systemd override. Stopped
startup mkdir of `~/.zoto-viz/plugins` and `~/.zoto-viz/agent-plugins`.
Consent store and `ZOTO_VIZ_PLUGIN_SERVICE` left unchanged.

### Agent Session Info
- Agent: generalPurpose
- Started: 2026-09-15T06:58:16.112Z
- Completed: 2026-09-15T07:02:43.436Z

### Work Log
- Created `plugins/.gitkeep` and `plugins/src/.gitkeep`.
- Added `plugins/.runtime/` to `.gitignore`; `git check-ignore` confirms zips and `plugins/src/**` stay tracked.
- Added `repo_root()`, `plugin_zips_dir()`, `plugin_src_dir()`, `plugin_runtime_dir()` to `service/paths.py`. Detection: `ZOTO_VIZ_REPO_ROOT` then walk-up for `pyproject.toml` / `.git`, else `RuntimeError`. TODO left for `docs/install.md` (subtask 10).
- `write_systemd_override` now writes resolved `ZOTO_VIZ_ROOT` and `ZOTO_VIZ_REPO_ROOT`.
- Removed mkdir from `plugins_dir()` / `agent_plugins_dir()`. Guarded `plugins.seed()` so a missing dest is a no-op (monitor startup no longer creates `~/.zoto-viz/plugins`).
- Tests: `tests/test_paths.py` (10 passed) plus `test_sysconfig.py` / `test_plugins.py` (39 passed together).

### Blockers Encountered
None.

### Files Modified
- `plugins/.gitkeep` (created)
- `plugins/src/.gitkeep` (created)
- `.gitignore`
- `service/paths.py`
- `service/sysconfig.py`
- `service/plugins.py` (seed mkdir guard only)
- `tests/test_paths.py`
- `tests/test_sysconfig.py`
- this subtask file
