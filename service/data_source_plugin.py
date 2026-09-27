"""Public data-source plugin kind: manifest validation and demo snapshot HTTP."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

_HOST_RE = re.compile(
    r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^[a-z0-9][a-z0-9.-]{0,253}[a-z0-9]$",
    re.IGNORECASE,
)
_OUTPUT_SHAPES = frozenset({"vizFrame", "headlines", "json"})
_MAX_SNAPSHOT_BYTES = 256_000


def plugin_kind(doc: dict[str, Any]) -> str:
    kind = doc.get("kind")
    if kind is None:
        return "view"
    if kind == "data-source":
        return "data-source"
    raise ValueError(f"kind must be 'data-source' when set, got {kind!r}")


def check_data_source_semantics(doc: dict[str, Any]) -> None:
    """Schema follow-up for ``kind: data-source`` (no tree I/O)."""
    if plugin_kind(doc) != "data-source":
        return
    for key in ("frontend", "backend", "entry", "service", "runtime", "capabilities", "viz"):
        if doc.get(key):
            raise ValueError(f"data-source plugins must not declare {key!r}")
    if doc.get("datasource") or doc.get("consumes") or doc.get("produces"):
        raise ValueError("data-source plugins use dataSource.sources, not datasource consumes/produces")
    block = doc.get("dataSource")
    if not isinstance(block, dict):
        raise ValueError("dataSource block is required when kind is data-source")
    sources = block.get("sources")
    if not isinstance(sources, list) or not sources:
        raise ValueError("dataSource.sources must be a non-empty list")
    seen: set[str] = set()
    for i, row in enumerate(sources):
        if not isinstance(row, dict):
            raise ValueError(f"dataSource.sources[{i}] must be a mapping")
        sid = str(row.get("id") or "").strip()
        if not sid or sid in seen:
            raise ValueError(f"dataSource.sources[{i}].id must be unique and non-empty")
        seen.add(sid)
        hosts = row.get("hosts")
        if not isinstance(hosts, list) or not hosts:
            raise ValueError(f"dataSource.sources[{i}].hosts must be a non-empty list")
        for j, host in enumerate(hosts):
            h = str(host or "").strip().lower()
            if not h or not _HOST_RE.match(h):
                raise ValueError(f"dataSource.sources[{i}].hosts[{j}] must be a hostname, got {host!r}")
        refresh = row.get("refreshSec")
        if not isinstance(refresh, int) or refresh < 1 or refresh > 86400:
            raise ValueError(f"dataSource.sources[{i}].refreshSec must be an integer from 1 to 86400")
        if row.get("apiKeyRequired") not in (True, False):
            raise ValueError(f"dataSource.sources[{i}].apiKeyRequired must be true or false")
        shape = row.get("outputShape")
        if shape not in _OUTPUT_SHAPES:
            raise ValueError(
                f"dataSource.sources[{i}].outputShape must be one of {sorted(_OUTPUT_SHAPES)}",
            )
        snap = str(row.get("demoSnapshot") or "").strip()
        if not snap or snap.startswith("/") or ".." in snap.split("/"):
            raise ValueError(f"dataSource.sources[{i}].demoSnapshot must be a relative path under the plugin root")


def validate_data_source_tree(home: Path, doc: dict[str, Any]) -> None:
    """Ensure bundled demo snapshots exist and are labelled demo data."""
    if plugin_kind(doc) != "data-source":
        return
    check_data_source_semantics(doc)
    block = doc.get("dataSource")
    assert isinstance(block, dict)
    for row in block.get("sources") or []:
        if not isinstance(row, dict):
            continue
        rel = str(row.get("demoSnapshot") or "").strip()
        path = (home / rel).resolve()
        try:
            if not path.is_relative_to(home.resolve()):
                raise ValueError(f"{rel}: demoSnapshot path escapes plugin root")
        except AttributeError:
            if not str(path).startswith(str(home.resolve())):
                raise ValueError(f"{rel}: demoSnapshot path escapes plugin root")
        if not path.is_file():
            raise ValueError(f"{rel}: demo snapshot file is missing")
        try:
            raw = path.read_bytes()
        except OSError as e:
            raise ValueError(f"{rel}: could not read demo snapshot: {e}") from e
        if len(raw) > _MAX_SNAPSHOT_BYTES:
            raise ValueError(f"{rel}: demo snapshot exceeds {_MAX_SNAPSHOT_BYTES} bytes")
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            raise ValueError(f"{rel}: demo snapshot must be UTF-8 JSON: {e}") from e
        if not isinstance(payload, dict):
            raise ValueError(f"{rel}: demo snapshot root must be a JSON object")
        if payload.get("demo") is not True:
            raise ValueError(f"{rel}: demo snapshot must set demo: true")


def source_row(doc: dict[str, Any], source_id: str) -> dict[str, Any] | None:
    block = doc.get("dataSource")
    if not isinstance(block, dict):
        return None
    for row in block.get("sources") or []:
        if isinstance(row, dict) and str(row.get("id") or "") == source_id:
            return row
    return None


def read_demo_snapshot(home: Path, doc: dict[str, Any], source_id: str) -> dict[str, Any]:
    row = source_row(doc, source_id)
    if row is None:
        raise KeyError(source_id)
    rel = str(row.get("demoSnapshot") or "").strip()
    path = (home / rel).resolve()
    raw = path.read_bytes()
    if len(raw) > _MAX_SNAPSHOT_BYTES:
        raise ValueError("demo snapshot too large")
    payload = json.loads(raw.decode("utf-8"))
    if not isinstance(payload, dict) or payload.get("demo") is not True:
        raise ValueError("invalid demo snapshot")
    return payload
