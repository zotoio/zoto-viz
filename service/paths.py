"""User and system directories for zoto-viz, with a one-time migrate from z-netviz."""
from __future__ import annotations

from pathlib import Path

APP = "zoto-viz"
OLD_APP = "z-netviz"

_HOME = Path.home()
_OLD_USER = _HOME / f".{OLD_APP}"
_NEW_USER = _HOME / f".{APP}"
_OLD_CFG = _HOME / ".config" / OLD_APP
_NEW_CFG = _HOME / ".config" / APP


def migrate_dir(old: Path, new: Path) -> Path:
    """If `new` is missing and `old` exists, rename it. Returns `new` either way."""
    if new.exists() or not old.exists():
        return new
    new.parent.mkdir(parents=True, exist_ok=True)
    old.rename(new)
    return new


def user_dir() -> Path:
    return migrate_dir(_OLD_USER, _NEW_USER)


def config_dir() -> Path:
    return migrate_dir(_OLD_CFG, _NEW_CFG)


def plugins_dir() -> Path:
    d = user_dir() / "plugins"
    d.mkdir(parents=True, exist_ok=True)
    return d


def profiles_file() -> Path:
    d = user_dir()
    d.mkdir(parents=True, exist_ok=True)
    return d / "profiles.yml"


def sys_config_file() -> Path:
    d = user_dir()
    d.mkdir(parents=True, exist_ok=True)
    return d / "sys-config.yml"
