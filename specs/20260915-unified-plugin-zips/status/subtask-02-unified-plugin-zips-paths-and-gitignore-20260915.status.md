# Subtask 02 — Unified Plugin Zips — live status

<!-- status:metadata:start -->
| Key | Value |
|-----|-------|
| schema_version | 1 |
| subtask_id | 02 |
| feature | Unified Plugin Zips |
| assigned_agent | generalPurpose |
| model | composer-2.5-fast |
| token_budget | 200000 |
| state | completed |
| started_at | 2026-09-15T06:58:16.112Z |
| last_heartbeat | 2026-09-15T07:14:17.047Z |
| completed_at | 2026-09-15T07:02:43.436Z |
| git_sha | f1e50b65f1f18ad0787bea3c763179138777ebc1 |
| agent_session_id |  |
<!-- status:metadata:end -->

<!-- status:checklist:start -->
- [x] **D01** — Create `plugins/` directory at the repo root, initially containing a (`plugins/.gitkeep`)
- [x] **D02** — Update `.gitignore`: (`.gitignore`)
- [x] **D03** — Extend `service/paths.py` with: (`service/paths.py`)
- [x] **D04** — Wire `ZOTO_VIZ_REPO_ROOT` into the systemd override that (`service/sysconfig.py`)
- [x] **D05** — Document the detection order + systemd wiring in `docs/install.md` (`service/paths.py`)
- [x] **D06** — Remove/guard existing `mkdir(parents=True, exist_ok=True)` calls (`service/paths.py`)
- [x] **D07** — Keep `~/.zoto-viz/plugin-consent.yml` handling exactly as-is — it is (`service/plugins.py`)
- [x] **D08** — Add `tests/test_paths.py::test_plugin_dirs_resolve` (or extend the (`tests/test_paths.py`)
<!-- status:checklist:end -->

<!-- status:artifacts:start -->
- **created** `plugins/.gitkeep` — repo-root
- **created** `plugins/src/.gitkeep` — editable
- **modified** `.gitignore` — ignore
- **modified** `service/paths.py` — repo_root
- **modified** `service/sysconfig.py` — Environment=ZOTO_VIZ_REPO_ROOT
- **modified** `service/plugins.py` — seed
- **modified** `tests/test_paths.py` — plugin-dirs-repo-root-RuntimeError-systemd
- **modified** `tests/test_sysconfig.py` — assert-ZOTO_VIZ_REPO_ROOT
- **modified** `specs/20260915-unified-plugin-zips/subtask-02-unified-plugin-zips-paths-and-gitignore-20260915.md` — checkboxes-and-execution-notes
<!-- status:artifacts:end -->

<!-- status:errors:start -->
_None._
<!-- status:errors:end -->

<!-- status:notes:start -->
Repo-root plugins/ catalog paths, gitignore for .runtime/, systemd ZOTO_VIZ_REPO_ROOT, no startup mkdir of legacy home plugin dirs. Consent unchanged. tests/test_paths.py 10 passed.
<!-- status:notes:end -->
