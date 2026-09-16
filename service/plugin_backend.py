"""Unified-plugin Python host: ``backend/service.py`` artefacts and module names.

Hot-load itself stays in ``service.hooks`` so setup / teardown / on_snapshot keep
today's Host + snapshot contract. This module names the unified files, hashes
them with the subtask-03 helper, and attaches catalog metadata (including
``datasource/streams.yml``) without touching frontend ``/plugins`` fields.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from .plugin_zip import plugin_sha256

BACKEND_REL = "backend/service.py"
COLLECTOR_REL = "datasource/collector.py"
STREAMS_RELS = ("datasource/streams.yml", "datasource/streams.yaml")
_LEGACY_MOD = "zoto_viz_plugin_"


def plugin_home(path: Path) -> Path:
    path = Path(path)
    if path.name in ("plugin.yml", "plugin.yaml"):
        return path.parent
    return path.parent


def backend_file(home: Path) -> Path:
    return Path(home) / "backend" / "service.py"


def collector_file(home: Path) -> Path:
    return Path(home) / "datasource" / "collector.py"


def streams_file(home: Path) -> Path | None:
    home = Path(home)
    for rel in STREAMS_RELS:
        cand = home / rel
        if cand.is_file():
            return cand
    return None


def module_name(pid: str, path: Path, *, kind: str | None = None) -> str:
    """Distinct sys.modules key so a reload replaces the previous module."""
    slug = str(pid).replace("-", "_")
    path = Path(path)
    if kind == "collector" or path.name == "collector.py":
        return f"plugin_{slug}_collector"
    if kind == "backend" or (path.parent.name == "backend" and path.name == "service.py"):
        return f"plugin_{slug}_backend"
    return f"{_LEGACY_MOD}{slug}"


def artefacts(path: Path) -> dict[str, Any]:
    """Hashes + streams mapping for a plugin.yml (or its directory). Does not import Python."""
    home = plugin_home(path)
    extra: dict[str, Any] = {}
    backend = backend_file(home)
    collector = collector_file(home)
    try:
        if backend.is_file():
            extra["backend_sha256"] = plugin_sha256(backend)
        if collector.is_file():
            extra["collector"] = COLLECTOR_REL
            extra["collector_sha256"] = plugin_sha256(collector)
    except OSError:
        return extra
    streams_path = streams_file(home)
    if streams_path is not None:
        from . import plugin_datasource as pds

        parsed = pds.parse_streams(streams_path)
        if parsed:
            extra["streams"] = parsed
    return extra
