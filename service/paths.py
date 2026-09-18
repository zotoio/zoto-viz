"""User and system directories for zoto-viz, with a one-time migrate from z-netviz."""
from __future__ import annotations

import importlib.util
import os
from importlib.machinery import SourceFileLoader
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
    """Legacy user-dir plugin tree. Does not create the directory (catalog is repo-root plugins/)."""
    return user_dir() / "plugins"


def plugin_local_dir(*, create: bool = False) -> Path:
    """Operator / agent drop zone: ``~/.zoto-viz/plugins/local/*.zip``.

    Override with ``ZOTO_VIZ_PLUGIN_LOCAL``. Does not create the directory unless
    ``create`` is true (publish + the monitor watch loop).
    """
    env = os.environ.get("ZOTO_VIZ_PLUGIN_LOCAL", "").strip()
    d = Path(env).expanduser() if env else user_dir() / "plugins" / "local"
    if create:
        d.mkdir(parents=True, exist_ok=True)
    return d


def plugin_local_runtime_dir(*, create: bool = False) -> Path:
    """Unpack cache for local zips: ``<plugin_local_dir>/.runtime``."""
    d = plugin_local_dir(create=create) / ".runtime"
    if create:
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


def agent_dir() -> Path:
    d = user_dir() / "agent"
    d.mkdir(parents=True, exist_ok=True)
    return d


def agent_plugins_dir() -> Path:
    """Legacy user-dir agent-plugin tree. Does not create the directory."""
    return user_dir() / "agent-plugins"


def repo_root() -> Path:
    """Locate the zoto-viz checkout.

    Detection order:
    1. ``ZOTO_VIZ_REPO_ROOT`` env var, expanded and resolved
    2. Walk parents of this file until ``pyproject.toml`` or ``.git`` is found
    3. Raise ``RuntimeError`` — never silently fall back to ``/plugins`` or ``~/plugins``

    systemd user units get the same pin via ``Environment=ZOTO_VIZ_REPO_ROOT=<abs>``
    written by ``service.sysconfig.write_systemd_override``. Documented in
    ``docs/install.md``.
    """
    env = os.environ.get("ZOTO_VIZ_REPO_ROOT", "").strip()
    if env:
        return Path(env).expanduser().resolve()
    for parent in Path(__file__).resolve().parents:
        if (parent / "pyproject.toml").is_file() or (parent / ".git").exists():
            return parent
    raise RuntimeError("cannot locate zoto-viz repo root — set ZOTO_VIZ_REPO_ROOT")


def _catalog_root(explicit: Path | None) -> Path:
    return explicit if explicit is not None else repo_root()


def plugin_zips_dir(repo_root: Path | None = None) -> Path:
    """Local contrib drop zone (gitignored zips): ``<repo_root>/plugins``."""
    return _catalog_root(repo_root) / "plugins"


def plugin_src_dir(repo_root: Path | None = None) -> Path:
    """Shipped catalog: ``<repo_root>/plugins/src``."""
    return _catalog_root(repo_root) / "plugins" / "src"


def plugin_runtime_dir(repo_root: Path | None = None) -> Path:
    """Gitignored unpack cache: ``<repo_root>/plugins/.runtime``."""
    return _catalog_root(repo_root) / "plugins" / ".runtime"


def cli_path() -> Path:
    """Repo-root ``zoto-viz`` script (no ``.py`` suffix; shebang ``#!/usr/bin/env python3``)."""
    return Path(__file__).resolve().parents[1] / "zoto-viz"


_CLI_MOD = None


def load_cli():
    """Load the batch CLI module by path. Hyphenated, extensionless — not ``import``-able."""
    global _CLI_MOD
    if _CLI_MOD is not None:
        return _CLI_MOD
    path = cli_path()
    loader = SourceFileLoader("zoto_viz_cli", str(path))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    if spec is None:
        raise ImportError(f"cannot load CLI from {path}")
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    _CLI_MOD = mod
    return mod
