from __future__ import annotations

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
