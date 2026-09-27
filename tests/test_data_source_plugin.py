from __future__ import annotations

from pathlib import Path

import pytest

from service import plugins
from service import data_source_plugin as dsp

ROOT = Path(__file__).resolve().parents[1]
ISS = ROOT / "plugins" / "src" / "public-iss"


def test_valid_data_source_manifest_loads() -> None:
    doc = plugins.load_file(ISS / "plugin.yml")
    assert doc["kind"] == "data-source"
    assert doc["dataSource"]["sources"][0]["id"] == "position"


def test_validate_plugin_home_public_iss() -> None:
    merged = plugins.validate_plugin_home(ISS)
    assert merged["id"] == "public-iss"


def test_missing_demo_snapshot_rejected(tmp_path: Path) -> None:
    home = tmp_path / "bad"
    home.mkdir()
    (home / "plugin.yml").write_text(
        "kind: data-source\n"
        "id: bad-src\nname: Bad\nversion: 1\n"
        "dataSource:\n  sources:\n    - id: one\n"
        "      hosts: [example.com]\n"
        "      refreshSec: 60\n"
        "      apiKeyRequired: false\n"
        "      outputShape: json\n"
        "      demoSnapshot: snapshots/missing.demo.json\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="missing"):
        plugins.validate_plugin_home(home)


def test_demo_flag_required(tmp_path: Path) -> None:
    home = tmp_path / "nodemo"
    home.mkdir()
    snap = home / "snapshots"
    snap.mkdir()
    (snap / "x.demo.json").write_text('{"vizFrame": {}}', encoding="utf-8")
    (home / "plugin.yml").write_text(
        "kind: data-source\n"
        "id: nodemo\nname: N\nversion: 1\n"
        "dataSource:\n  sources:\n    - id: one\n"
        "      hosts: [example.com]\n"
        "      refreshSec: 60\n"
        "      apiKeyRequired: false\n"
        "      outputShape: json\n"
        "      demoSnapshot: snapshots/x.demo.json\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="demo: true"):
        plugins.validate_plugin_home(home)


def test_data_source_rejects_frontend() -> None:
    blocked = False
    try:
        plugins.validate_doc({
            "kind": "data-source",
            "id": "x",
            "name": "X",
            "version": 1,
            "frontend": {"entry": "frontend/index.ts"},
            "dataSource": {
                "sources": [{
                    "id": "a",
                    "hosts": ["example.com"],
                    "refreshSec": 10,
                    "apiKeyRequired": False,
                    "outputShape": "json",
                    "demoSnapshot": "snapshots/a.demo.json",
                }],
            },
        })
    except ValueError as e:
        blocked = "frontend" in str(e)
    assert blocked is True


def test_all_shipped_plugin_yml_still_load() -> None:
    src = ROOT / "plugins" / "src"
    errors: list[str] = []
    for child in sorted(src.iterdir()):
        if not (child / "plugin.yml").is_file():
            continue
        try:
            plugins.validate_plugin_home(child)
        except ValueError as e:
            errors.append(f"{child.name}: {e}")
    assert not errors, "\n".join(errors)


def test_read_demo_snapshot_iss() -> None:
    doc = plugins.load_file(ISS / "plugin.yml")
    payload = dsp.read_demo_snapshot(ISS, doc, "position")
    assert payload["demo"] is True
    assert "vizFrame" in payload
