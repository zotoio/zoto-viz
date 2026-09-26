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


def test_split_settings_in_plugin_config_in_visualisation(tmp_path: Path) -> None:
    """settings in plugin.yml + config in visualisation.yml (shipped layout)."""
    dest = tmp_path / "split-pack"
    dest.mkdir()
    (dest / "plugin.yml").write_text(
        yaml.safe_dump({
            "id": "split-pack",
            "name": "Split",
            "version": 1,
            "settings": {
                "presetField": "preset",
                "presets": [{"id": "a", "label": "A", "values": {"gain": 1}}],
            },
        }),
        encoding="utf-8",
    )
    (dest / "visualisation.yml").write_text(
        yaml.safe_dump({
            "engine": "graph",
            "config": [
                {"key": "preset", "type": "select", "values": [["a", "A"]]},
                {"key": "gain", "type": "number", "min": 0, "max": 10, "default": 1},
            ],
        }),
        encoding="utf-8",
    )
    result = plugins.scan(tmp_path)
    by_id = {p["id"]: p for p in result["plugins"]}
    assert "split-pack" in by_id
    assert not [e for e in result["errors"] if "split-pack" in str(e.get("error", ""))]


def test_split_pack_install_via_zip_runtime_scan(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from service import paths
    from service import plugin_zip as pz

    src = tmp_path / "split-pack"
    src.mkdir()
    (src / "plugin.yml").write_text(
        yaml.safe_dump({
            "id": "split-install",
            "name": "Split install",
            "version": 1,
            "settings": {"presetField": "preset", "presets": [{"id": "a", "label": "A", "values": {"gain": 2}}]},
        }),
        encoding="utf-8",
    )
    (src / "visualisation.yml").write_text(
        yaml.safe_dump({
            "engine": "graph",
            "config": [
                {"key": "preset", "values": [["a", "A"]]},
                {"key": "gain", "type": "number", "min": 0, "max": 10},
            ],
        }),
        encoding="utf-8",
    )
    zips = tmp_path / "zips"
    runtime = tmp_path / "runtime"
    zips.mkdir()
    runtime.mkdir()
    monkeypatch.setattr(paths, "plugin_zips_dir", lambda: zips)
    monkeypatch.setattr(paths, "plugin_runtime_dir", lambda: runtime)
    zip_path = zips / "split-install.zip"
    pz.pack_tree(src, zip_path)
    result = plugins.scan(zips)
    assert "split-install" in {p["id"] for p in result["plugins"]}
    assert not [e for e in result["errors"] if "split-install" in str(e.get("error", ""))]


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
    assert not result["plugins"]
    errs = [e for e in result["errors"] if "presetField" in str(e.get("error", ""))]
    assert errs
