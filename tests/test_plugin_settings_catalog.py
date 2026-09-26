from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from service import plugins

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "web" / "src" / "plugins" / "fixtures" / "settings-decl-pack"


def test_settings_fixture_pack_loads_via_catalog_scan(tmp_path: Path) -> None:
    dest = tmp_path / "settings-fixture"
    dest.mkdir()
    (dest / "plugin.yml").write_text((FIXTURE / "plugin.yml").read_text(encoding="utf-8"), encoding="utf-8")
    (dest / "visualisation.yml").write_text((FIXTURE / "visualisation.yml").read_text(encoding="utf-8"), encoding="utf-8")
    result = plugins.scan(tmp_path)
    by_id = {p["id"]: p for p in result["plugins"]}
    assert "settings-fixture" in by_id
    assert by_id["settings-fixture"].get("visualisation", {}).get("settings", {}).get("presetField") == "preset"
    assert not [e for e in result["errors"] if "settings-fixture" in str(e.get("error", ""))]


def test_bad_visualisation_settings_is_catalog_error(tmp_path: Path) -> None:
    dest = tmp_path / "bad-settings"
    dest.mkdir()
    (dest / "plugin.yml").write_text(
        yaml.safe_dump({"id": "bad-settings", "name": "Bad", "version": 1}),
        encoding="utf-8",
    )
    (dest / "visualisation.yml").write_text(
        yaml.safe_dump({
            "engine": "graph",
            "settings": {
                "presets": [{"id": "a", "label": "A", "values": {"gain": 1}}],
            },
            "config": [{"key": "gain", "type": "number", "min": 0, "max": 10}],
        }),
        encoding="utf-8",
    )
    result = plugins.scan(tmp_path)
    assert "bad-settings" not in {p["id"] for p in result["plugins"]}
    errs = [e for e in result["errors"] if "bad-settings" in str(e.get("error", ""))]
    assert errs
    assert "presetField" in errs[0]["error"]
