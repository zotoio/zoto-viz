from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from service import paths
from service import sysconfig


def test_user_dir_contains_zoto_viz() -> None:
    assert "zoto-viz" in str(paths.user_dir())


def test_config_dir_contains_zoto_viz() -> None:
    assert "zoto-viz" in str(paths.config_dir())


def test_migrate_dir_renames_old(tmp_path: Path) -> None:
    old = tmp_path / "old"
    new = tmp_path / "new"
    old.mkdir()
    (old / "keep.txt").write_text("ok", encoding="utf-8")
    got = paths.migrate_dir(old, new)
    assert got == new
    assert new.is_dir()
    assert not old.exists()
    assert (new / "keep.txt").read_text(encoding="utf-8") == "ok"


def test_migrate_dir_keeps_existing_new(tmp_path: Path) -> None:
    old = tmp_path / "old"
    new = tmp_path / "new"
    old.mkdir()
    new.mkdir()
    (new / "here.txt").write_text("keep", encoding="utf-8")
    got = paths.migrate_dir(old, new)
    assert got == new
    assert old.exists()
    assert (new / "here.txt").read_text(encoding="utf-8") == "keep"


def test_plugins_and_profiles_paths() -> None:
    plugins = paths.plugins_dir()
    assert plugins.name == "plugins"
    assert paths.profiles_file().name == "profiles.yml"
    assert paths.sys_config_file().name == "sys-config.yml"
    assert paths.agent_dir().name == "agent"
    assert paths.agent_plugins_dir().name == "agent-plugins"


def test_plugin_dirs_resolve(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = paths.repo_root()
    assert (root / ".git").exists() or (root / "pyproject.toml").is_file()
    assert paths.plugin_zips_dir() == root / "plugins"
    assert paths.plugin_src_dir() == root / "plugins" / "src"
    assert paths.plugin_runtime_dir() == root / "plugins" / ".runtime"
    monkeypatch.chdir(root / "service")
    assert paths.repo_root() == root
    assert paths.plugin_zips_dir() == root / "plugins"
    other = tmp_path / "alt-checkout"
    assert paths.plugin_zips_dir(other) == other / "plugins"
    assert paths.plugin_src_dir(other) == other / "plugins" / "src"
    assert paths.plugin_runtime_dir(other) == other / "plugins" / ".runtime"
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(other))
    assert paths.repo_root() == other.resolve()
    assert paths.plugin_zips_dir() == other.resolve() / "plugins"


def test_repo_root_raises_without_sentinel_or_env(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ZOTO_VIZ_REPO_ROOT", raising=False)
    isolated = tmp_path / "no-sentinel" / "service" / "paths.py"
    isolated.parent.mkdir(parents=True)
    isolated.write_text("", encoding="utf-8")
    monkeypatch.setattr(paths, "__file__", str(isolated))

    def no_sentinels(parent: Path) -> bool:
        return not (parent / "pyproject.toml").is_file() and not (parent / ".git").exists()

    if not all(no_sentinels(p) for p in isolated.resolve().parents):
        pytest.skip("tmp_path ancestors contain a repo sentinel; cannot assert the miss path")
    with pytest.raises(RuntimeError, match="cannot locate zoto-viz repo root — set ZOTO_VIZ_REPO_ROOT"):
        paths.repo_root()


def test_systemd_override_contains_repo_root(tmp_path: Path) -> None:
    drop = tmp_path / "override.conf"
    got = sysconfig.write_systemd_override({"root": "/opt/zoto-viz"}, drop)
    assert got == drop
    text = drop.read_text(encoding="utf-8")
    assert "Environment=ZOTO_VIZ_REPO_ROOT=/opt/zoto-viz" in text
    assert "Environment=ZOTO_VIZ_ROOT=/opt/zoto-viz" in text
    assert "WorkingDirectory=/opt/zoto-viz" in text
    assert "ExecStart=/opt/zoto-viz/.venv/bin/python -m service.monitor" in text


def test_legacy_plugin_home_dirs_do_not_mkdir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    home = tmp_path / "user-home"
    monkeypatch.setattr(paths, "user_dir", lambda: home)
    plug = paths.plugins_dir()
    agent = paths.agent_plugins_dir()
    assert plug == home / "plugins"
    assert agent == home / "agent-plugins"
    assert not plug.exists()
    assert not agent.exists()
    assert not home.exists()


def test_gitignore_runtime_and_plugin_zips() -> None:
    root = paths.repo_root()
    gitignore = (root / ".gitignore").read_text(encoding="utf-8")
    assert "plugins/.runtime/" in gitignore
    assert "plugins/*.zip" in gitignore

    def ignored(rel: str) -> bool:
        proc = subprocess.run(
            ["git", "check-ignore", "-q", "--no-index", rel],
            cwd=root,
            check=False,
        )
        return proc.returncode == 0

    assert ignored("plugins/.runtime/example/plugin.yml")
    assert ignored("plugins/example.zip")
    assert not ignored("plugins/src/example/plugin.yml")
    assert not ignored("examples/plugins/sample.zip")


def test_cli_path_and_load() -> None:
    path = paths.cli_path()
    assert path.name == "zoto-viz"
    assert path.is_file()
    first = path.read_text(encoding="utf-8").splitlines()[0]
    assert first == "#!/usr/bin/env python3"
    mod = paths.load_cli()
    assert hasattr(mod, "main")
    assert paths.load_cli() is mod
