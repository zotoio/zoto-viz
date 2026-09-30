"""plugin.yml ``picker: hidden``: the 7 shipped test / fixture packs, schema-checked.

Revert rows: remove ``picker`` from schema/plugin.schema.json -> the 7 packs fail validation
(additionalProperties) and ``test_the_seven_are_hidden`` goes red; drop the line from a pack's
plugin.yml -> the count rows go red.
"""
from __future__ import annotations

import pytest

from service import plugins

HIDDEN = {
    "host-mesh-demo", "sandbox-fixture-multi", "tile-health-black", "tile-health-detail",
    "tile-health-lose-ctx", "tile-health-stall", "tile-health-static",
}


@pytest.fixture(scope="module")
def rows() -> list[dict]:
    plugins.reset_scan_memo()
    result = plugins.scan()
    src = [r for r in result["plugins"] if r.get("origin") == "src"]
    assert not [e for e in result.get("errors") or [] if "/plugins/src/" in str(e.get("file"))], result.get("errors")
    return src


def test_the_seven_are_hidden(rows: list[dict]) -> None:
    assert {r["id"] for r in rows if r.get("picker") == "hidden"} == HIDDEN


def test_pick_every_view_goes_from_70_to_63(rows: list[dict]) -> None:
    views = [r for r in rows if r.get("pluginKind") != "data-source"]
    assert len(views) == 70
    assert len([r for r in views if r.get("picker") != "hidden"]) == 63


def test_schema_accepts_hidden_and_rejects_other_values() -> None:
    v = plugins.validator()
    base = {"id": "demo-pack", "name": "Demo", "version": 1}
    assert not list(v.iter_errors({**base, "picker": "hidden"}))
    assert list(v.iter_errors({**base, "picker": "shown"}))
