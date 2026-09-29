from __future__ import annotations

import json
from pathlib import Path

from service import live
from service import repo_sync as rs


def test_disabled_by_env(monkeypatch) -> None:
    monkeypatch.setenv(rs.SKIP_ENV, "1")
    assert rs.disabled() is True
    info = rs.pull(Path("/tmp"))
    assert info["action"] == "skipped"


def test_interval_zero_disables(monkeypatch) -> None:
    monkeypatch.delenv(rs.SKIP_ENV, raising=False)
    monkeypatch.setenv(rs.INTERVAL_ENV, "0")
    assert rs.disabled() is True
    assert rs.interval_s() == 0.0


def test_interval_default(monkeypatch) -> None:
    monkeypatch.delenv(rs.SKIP_ENV, raising=False)
    monkeypatch.delenv(rs.INTERVAL_ENV, raising=False)
    assert rs.disabled() is False
    assert rs.interval_s() == rs.DEFAULT_INTERVAL_S


def test_needs_web_and_pip() -> None:
    assert rs._needs_web_build(["web/src/app/main.ts"])
    assert rs._needs_web_build(["plugins/src/syscon/plugin.yml"])
    assert not rs._needs_web_build(["docs/install.md"])
    assert rs._needs_pip(["requirements.txt", "README.md"])
    assert not rs._needs_pip(["service/live.py"])


def test_pull_skips_non_git(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.delenv(rs.SKIP_ENV, raising=False)
    monkeypatch.delenv(rs.INTERVAL_ENV, raising=False)
    monkeypatch.setattr(rs, "is_git_checkout", lambda root: False)
    info = rs.pull(tmp_path)
    assert info["action"] == "noop"
    assert info["reason"] == "not a git checkout"


def test_pull_skips_dirty(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.delenv(rs.SKIP_ENV, raising=False)
    monkeypatch.delenv(rs.INTERVAL_ENV, raising=False)
    monkeypatch.setattr(rs, "is_git_checkout", lambda root: True)
    monkeypatch.setattr(rs, "_merging", lambda root: False)
    monkeypatch.setattr(rs, "_dirty", lambda root: True)
    info = rs.pull(tmp_path)
    assert info["reason"] == "dirty worktree"


def test_tick_reloads_and_schedules_restart(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.delenv(rs.SKIP_ENV, raising=False)
    monkeypatch.delenv(rs.INTERVAL_ENV, raising=False)
    live.reset_for_tests()
    monkeypatch.setattr(rs, "pull", lambda root=None: {
        "action": "pulled",
        "from": "aaa",
        "to": "bbb",
        "files": ["docs/install.md"],
    })
    monkeypatch.setattr(rs, "apply_updates", lambda root, files: {"built": False, "pip": False})
    scheduled: list[Path] = []
    monkeypatch.setattr(rs, "schedule_restart", lambda root, delay_s=rs.RESTART_DELAY_S: (
        scheduled.append(root) or {"restart": "scheduled", "delay_s": delay_s}
    ))
    info = rs.tick(tmp_path)
    assert info["action"] == "pulled"
    assert info["reloadClient"] is True
    assert info["restart"] == "scheduled"
    assert scheduled == [tmp_path.resolve()]
    snap = live.snapshot()
    assert snap["patch"]["reloadClient"] is True


def test_tick_fresh_does_not_restart(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(rs, "pull", lambda root=None: {"action": "fresh", "from": "aaa", "to": "aaa"})
    called = []
    monkeypatch.setattr(rs, "schedule_restart", lambda *a, **k: called.append(1))
    info = rs.tick(tmp_path)
    assert info["action"] == "fresh"
    assert called == []


def _exe(path: Path, body: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/bin/sh\n" + body + "\n", encoding="utf-8")
    path.chmod(0o755)
    return path


def _repo(tmp_path: Path) -> Path:
    root = tmp_path / "repo"
    (root / "web" / "dist").mkdir(parents=True)
    (root / "web" / "dist" / "index.html").write_text("old", encoding="utf-8")
    (root / ".nvmrc").write_text("22\n", encoding="utf-8")
    (root / "web" / "package.json").write_text('{"engines": {"node": ">=22.12.0"}}', encoding="utf-8")
    return root


def _nvm(tmp_path: Path, monkeypatch, *versions: str) -> Path:
    nvm = tmp_path / "nvm"
    for v in versions:
        _exe(nvm / "versions" / "node" / v / "bin" / "node", f"echo {v}")
    monkeypatch.setenv("NVM_DIR", str(nvm))
    return nvm


def _path_node(tmp_path: Path, monkeypatch, version: str) -> None:
    bin_dir = tmp_path / "pathbin"
    _exe(bin_dir / "node", f"echo {version}")
    monkeypatch.setenv("PATH", f"{bin_dir}:/usr/bin:/bin")


def test_find_node_prefers_nvmrc_major_over_old_path_node(monkeypatch, tmp_path: Path) -> None:
    """zoto's first node is nvm v18, which breaks rolldown; the build must use the newest fitting 22."""
    root = _repo(tmp_path)
    nvm = _nvm(tmp_path, monkeypatch, "v18.20.2", "v22.11.0", "v22.23.2", "v24.1.0")
    _path_node(tmp_path, monkeypatch, "v18.20.2")
    node_bin, why = rs.find_node(root)
    assert why == ""
    assert node_bin == nvm / "versions" / "node" / "v22.23.2" / "bin"


def test_find_node_explains_when_nothing_fits(monkeypatch, tmp_path: Path) -> None:
    root = _repo(tmp_path)
    _nvm(tmp_path, monkeypatch, "v18.20.2")
    _path_node(tmp_path, monkeypatch, "v18.20.2")
    node_bin, why = rs.find_node(root)
    assert node_bin is None
    assert "Node 22 (>= 22.12.0)" in why and "v18.20.2 on PATH" in why


def test_find_node_accepts_fitting_path_node(monkeypatch, tmp_path: Path) -> None:
    root = _repo(tmp_path)
    _nvm(tmp_path, monkeypatch)
    _path_node(tmp_path, monkeypatch, "v22.12.0")
    node_bin, why = rs.find_node(root)
    assert why == "" and node_bin == tmp_path / "pathbin"


def _pnpm(nvm: Path, version: str, body: str) -> Path:
    log = nvm.parent / "pnpm.log"
    return _exe(
        nvm / "versions" / "node" / version / "bin" / "pnpm",
        f'echo "$(node --version) $*" >> {log}\n' + body,
    )


def test_build_web_swaps_dist_only_after_success(monkeypatch, tmp_path: Path) -> None:
    root = _repo(tmp_path)
    nvm = _nvm(tmp_path, monkeypatch, "v18.20.2", "v22.23.2")
    _path_node(tmp_path, monkeypatch, "v18.20.2")
    _pnpm(nvm, "v22.23.2", f'case "$*" in *build*) mkdir -p {root}/web/dist.next && echo new > {root}/web/dist.next/index.html;; esac')
    out = rs.build_web(root, install=True)
    assert out["built"] is True, out
    assert (root / "web" / "dist" / "index.html").read_text().strip() == "new"
    assert not (root / "web" / "dist.next").exists() and not (root / "web" / "dist.prev").exists()
    calls = (tmp_path / "pnpm.log").read_text().splitlines()
    assert calls[0].startswith("v22.23.2 ") and "install --frozen-lockfile" in calls[0]
    assert calls[1].startswith("v22.23.2 ") and calls[1].endswith("build --outDir dist.next --emptyOutDir")


def test_build_web_failure_keeps_old_dist_and_reports(monkeypatch, tmp_path: Path) -> None:
    root = _repo(tmp_path)
    nvm = _nvm(tmp_path, monkeypatch, "v22.23.2")
    _pnpm(nvm, "v22.23.2", f"mkdir -p {root}/web/dist.next; echo 'SyntaxError: styleText' >&2; exit 1")
    out = rs.build_web(root)
    assert out["built"] is False
    assert "build exit 1" in out["build_error"] and "styleText" in out["build_error"]
    assert (root / "web" / "dist" / "index.html").read_text() == "old"
    assert not (root / "web" / "dist.next").exists()


def test_build_web_without_fitting_node_never_runs_pnpm(monkeypatch, tmp_path: Path) -> None:
    root = _repo(tmp_path)
    _nvm(tmp_path, monkeypatch, "v18.20.2")
    _path_node(tmp_path, monkeypatch, "v18.20.2")
    out = rs.build_web(root)
    assert out["built"] is False and "needs Node 22" in out["build_error"]
    assert (root / "web" / "dist" / "index.html").read_text() == "old"


def test_apply_updates_installs_only_when_lockfile_moves(monkeypatch, tmp_path: Path) -> None:
    seen: list[bool] = []
    monkeypatch.setattr(rs, "build_web", lambda root, install=False: seen.append(install) or {"built": True})
    rs.apply_updates(tmp_path, ["web/src/ui/media-ask.ts"])
    rs.apply_updates(tmp_path, ["web/pnpm-lock.yaml", "web/src/app/main.ts"])
    rs.apply_updates(tmp_path, ["service/monitor.py"])
    assert seen == [False, True]


def test_tick_records_failed_build_in_status_file(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(rs.paths, "user_dir", lambda: tmp_path / "home")
    monkeypatch.setattr(rs, "pull", lambda root=None: {"action": "pulled", "from": "a" * 40, "to": "b" * 40, "files": ["web/x.ts"]})
    monkeypatch.setattr(rs, "apply_updates", lambda root, files: {"built": False, "pip": False, "build_error": "build exit 1: boom"})
    monkeypatch.setattr(rs, "schedule_restart", lambda root, delay_s=rs.RESTART_DELAY_S: {"restart": "scheduled"})
    monkeypatch.setattr(rs.live, "queue_patch", lambda patch: patch)
    info = rs.tick(tmp_path)
    assert info["build_error"] == "build exit 1: boom"
    status = json.loads((tmp_path / "home" / "repo-sync.json").read_text())
    assert status["ok"] is False and status["build_error"] == "build exit 1: boom" and status["to"] == "b" * 40
