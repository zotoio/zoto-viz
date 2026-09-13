from __future__ import annotations

from pathlib import Path

from service import paths


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
