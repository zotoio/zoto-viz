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


def _work_budget_json_schema() -> dict[str, Any]:
    """JSON Schema for visualisation.yml workBudget (#45 count budgets v2).

    TODO(#45 count-budgets-v2): import ``manifest_work_budget_json_schema`` from
    ``service.work_budget`` after rebase onto #45 — host-owned ceilings and int≥0
    bounds live only in that module (runtime clamp uses the same source).
    """
    try:
        from service.work_budget import manifest_work_budget_json_schema
    except ImportError:
        return {
            "type": "object",
            "description": (
                "Pending #45: strict workBudget typing is injected from "
                "service.work_budget.manifest_work_budget_json_schema()."
            ),
        }
    return manifest_work_budget_json_schema()


def _inject_visualisation_manifest_keys(schema: dict[str, Any]) -> None:
    viz = schema.get("$defs", {}).get("visualisation")
    if not isinstance(viz, dict):
        return
    props = viz.get("properties")
    if not isinstance(props, dict):
        return
    props["workBudget"] = _work_budget_json_schema()


def load_plugin_schema() -> dict[str, Any]:
    raw = yaml.safe_load(PLUGIN_SCHEMA_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"{PLUGIN_SCHEMA_PATH} is not a mapping")
    schema = deref_schema(raw, PLUGIN_SCHEMA_PATH)
    _inject_visualisation_manifest_keys(schema)
    return schema
