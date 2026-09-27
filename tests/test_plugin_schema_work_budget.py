from __future__ import annotations

import json
from pathlib import Path

import yaml

from service import paths
from service.plugins import _visualisation_doc, deref_schema

REPO = paths.repo_root()
MANIFEST_WB_SCHEMA = REPO / "plugins" / "sdk" / "manifest-work-budget.schema.json"
PLUGIN_SCHEMA = REPO / "schema" / "plugin.schema.json"


def test_manifest_work_budget_schema_ref_resolves_from_plugin_schema() -> None:
    shim = {
        "title": "workBudget",
        "$ref": "../plugins/sdk/manifest-work-budget.schema.json",
    }
    resolved = deref_schema(shim, PLUGIN_SCHEMA)
    assert resolved.get("type") == "object"
    assert "maxDrawCalls" in resolved.get("properties", {})
    assert "maxSimStepsPerFrame" in resolved.get("required", [])


def test_visualisation_yml_work_budget_loads_via_catalog_path(tmp_path: Path) -> None:
    home = tmp_path / "pack"
    home.mkdir()
    (home / "visualisation.yml").write_text(
        yaml.safe_dump(
            {
                "engine": "graph",
                "workBudget": {
                    "maxDrawCalls": 1,
                    "maxTriangles": 1,
                    "maxInstances": 1,
                    "maxGpuBytes": 1,
                    "maxSimStepsPerFrame": 1,
                    "maxPacketsPerFrame": 1,
                },
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    doc = _visualisation_doc(home)
    assert doc is not None
    assert doc["workBudget"]["maxDrawCalls"] == 1


def test_manifest_work_budget_schema_matches_policy_keys() -> None:
    policy = json.loads(
        (REPO / "service" / "policy" / "work-budget-ceilings.json").read_text(encoding="utf-8")
    )
    schema = json.loads(MANIFEST_WB_SCHEMA.read_text(encoding="utf-8"))
    assert sorted(policy.keys()) == sorted(schema["required"])
