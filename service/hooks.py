"""Hot-load plugin Python into the monitor.

Directory plugins may ship ``backend/service.py`` (unified zip layout) or the
legacy ``service/__init__.py`` / ``service.py`` (or a ``service:`` path in
plugin.yml). The module runs in-process with the monitor — local/trusted, not
the TypeScript iframe sandbox. Optional hooks:

    setup(host)              once after load / reload
    teardown(host)           before unload / reload
    on_snapshot(host, msg)   1 Hz, mutates the snapshot dict before it is sent

Unified backends load as ``plugin_<id>_backend``. Collectors live in
``service.plugin_datasource`` and share this sync / unload lifecycle.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Callable

from .plugin_backend import backend_file, module_name as _module_name
from . import plugin_datasource as _datasource


class Host:
    """What a plugin service module sees. Keep this small so hooks stay portable."""

    def __init__(self, plugin_id: str, *, app: Any | None = None, state: Any = None) -> None:
        self.plugin_id = plugin_id
        self.app = app
        self.state = state

    def log(self, msg: str) -> None:
        print(f"[plugin:{self.plugin_id}] {msg}", file=sys.stderr)


_loaded: dict[str, dict[str, Any]] = {}
_host_factory: Callable[[str], Host] | None = None


def bind(factory: Callable[[str], Host]) -> None:
    global _host_factory
    _host_factory = factory


def loaded() -> dict[str, dict[str, Any]]:
    return _loaded


def unload_all() -> None:
    for pid in list(_loaded):
        _drop(pid)
    _datasource.unload_all()


def reset() -> None:
    global _host_factory
    unload_all()
    _host_factory = None
    _datasource.reset()


def service_path(home: Path, doc: dict[str, Any], *, yaml_path: Path | None = None) -> Path | None:
    """Resolve the Python entry for a plugin. Confined to `home`.

    Auto-detect `service/__init__.py` / `service.py` only for directory plugins
    (`plugin.yml`) so a stray `service.py` in a user-dir tree is not attached
    to every flat YAML overlay.
    """
    raw = str(doc.get("service") or "").strip()
    home = home.resolve()
    if raw:
        target = (home / raw).resolve()
        if not _inside(home, target):
            raise ValueError("service module must stay inside the plugin directory")
        return target
    directory = yaml_path is None or yaml_path.name in ("plugin.yml", "plugin.yaml")
    if not directory:
        return None
    for cand in (backend_file(home), home / "service" / "__init__.py", home / "service.py"):
        if cand.is_file():
            return cand
    return None


def _inside(home: Path, target: Path) -> bool:
    try:
        target.relative_to(home)
        return True
    except ValueError:
        return False


def stamp(mtime: float, path: Path) -> float:
    """Newest .py under a service package, else the file itself."""
    if path.name != "__init__.py":
        return mtime
    latest = mtime
    for child in path.parent.rglob("*.py"):
        try:
            latest = max(latest, child.stat().st_mtime)
        except OSError:
            continue
    return latest


def sync(plugins: list[dict[str, Any]], *, allow: Callable[[dict[str, Any]], bool] | None = None) -> None:
    """Load, reload, or drop service modules to match the current plugin scan.

    `allow` is an extra gate (env + operator consent). Tests omit it.
    """
    factory = _host_factory
    wanted: dict[str, Path] = {}
    for spec in plugins:
        pid = str(spec.get("id") or "")
        file = spec.get("file")
        if not pid or not file:
            continue
        if allow is not None and not allow(spec):
            continue
        yaml_path = Path(file)
        home = yaml_path.parent
        try:
            path = service_path(home, spec, yaml_path=yaml_path)
        except ValueError as e:
            print(f"[plugin:{pid}] {e}", file=sys.stderr)
            continue
        try:
            ok = bool(path and path.is_file())
        except OSError:
            continue
        if ok:
            wanted[pid] = path

    for pid in list(_loaded):
        if pid not in wanted:
            _drop(pid)

    for pid, path in wanted.items():
        try:
            mtime = stamp(path.stat().st_mtime, path)
        except OSError:
            _drop(pid)
            continue
        cur = _loaded.get(pid)
        if cur and cur["path"] == path and cur["mtime"] == mtime:
            if factory:
                cur["host"] = factory(pid)
            continue
        _load(pid, path, mtime, factory)

    _datasource.sync(plugins, allow=allow)


def on_snapshot(msg: dict[str, Any]) -> dict[str, Any]:
    _call("on_snapshot", msg)
    return msg


def _call(name: str, *args: Any) -> None:
    for pid, rec in list(_loaded.items()):
        fn = getattr(rec["module"], name, None)
        if not callable(fn):
            continue
        try:
            if name == "on_snapshot":
                fn(rec["host"], *args)
            elif name in ("setup", "teardown"):
                fn(rec["host"])
            else:
                fn(rec["host"], *args)
        except Exception as e:  # noqa: BLE001 — a plugin must not take down the monitor
            print(f"[plugin:{pid}] {name}: {type(e).__name__}: {e}", file=sys.stderr)


def _load(pid: str, path: Path, mtime: float, factory: Callable[[str], Host] | None) -> None:
    if pid in _loaded:
        _drop(pid)
    name = _module_name(pid, path)
    search = [str(path.parent)] if path.name == "__init__.py" else None
    spec = importlib.util.spec_from_file_location(name, path, submodule_search_locations=search)
    if spec is None or spec.loader is None:
        print(f"[plugin:{pid}] could not load {path}", file=sys.stderr)
        return
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    try:
        spec.loader.exec_module(mod)
    except Exception as e:  # noqa: BLE001
        sys.modules.pop(name, None)
        print(f"[plugin:{pid}] load failed: {type(e).__name__}: {e}", file=sys.stderr)
        return
    host = factory(pid) if factory else Host(pid)
    rec = {"path": path, "mtime": mtime, "module": mod, "host": host, "name": name}
    _loaded[pid] = rec
    setup = getattr(mod, "setup", None)
    if callable(setup):
        try:
            setup(host)
        except Exception as e:  # noqa: BLE001
            print(f"[plugin:{pid}] setup: {type(e).__name__}: {e}", file=sys.stderr)


def _drop(pid: str) -> None:
    rec = _loaded.pop(pid, None)
    if not rec:
        return
    teardown = getattr(rec["module"], "teardown", None)
    if callable(teardown):
        try:
            teardown(rec["host"])
        except Exception as e:  # noqa: BLE001
            print(f"[plugin:{pid}] teardown: {type(e).__name__}: {e}", file=sys.stderr)
    prefix = rec["name"] + "."
    for key in [k for k in sys.modules if k == rec["name"] or k.startswith(prefix)]:
        sys.modules.pop(key, None)
