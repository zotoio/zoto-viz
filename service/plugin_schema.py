"""Single Python entry for schema/plugin.schema.json (backend source of truth)."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

REPO = Path(__file__).resolve().parents[1]
PLUGIN_SCHEMA_PATH = REPO / "schema" / "plugin.schema.json"
_SCHEMA_KEYS = frozenset({"$ref", "$schema", "$id", "title", "description"})


def deref_schema(raw: dict[str, Any], origin: Path) -> dict[str, Any]:
    """Follow a one-line sibling `$ref` shim (view/agent-plugin → plugin.schema.json)."""
    ref = raw.get("$ref")
    if (
        not isinstance(ref, str)
        or not ref.endswith(".json")
        or "://" in ref
        or "#" in ref
    ):
        return raw
    if any(key not in _SCHEMA_KEYS for key in raw):
        return raw
    target = (origin.parent / ref).resolve()
    if target.parent != origin.parent.resolve() or not target.is_file():
        raise ValueError(f"unresolved schema $ref {ref!r}")
    loaded = yaml.safe_load(target.read_text(encoding="utf-8"))
    if not isinstance(loaded, dict):
        raise ValueError(f"{target.name} is not a mapping")
    return loaded


def load_plugin_schema() -> dict[str, Any]:
    raw = yaml.safe_load(PLUGIN_SCHEMA_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"{PLUGIN_SCHEMA_PATH} is not a mapping")
    return deref_schema(raw, PLUGIN_SCHEMA_PATH)
