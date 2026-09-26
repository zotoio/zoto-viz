"""Pure ``settings_check`` on staging-style directories (#38 → #35 check list)."""
from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from service import plugins

GOOD_VIZ = (
    "engine: graph\n"
    "settings:\n"
    "  presetField: preset\n"
    "  presets:\n"
    "    - id: a\n"
    "      label: A\n"
    "      values: {gain: 1, preset: a}\n"
    "config:\n"
    "  - key: preset\n"
    "    type: select\n"
    "    values: [[a, A]]\n"
    "  - key: gain\n"
    "    type: number\n"
    "    min: 0\n"
    "    max: 10\n"
)

MERGED_ONLY_BAD_PLUGIN = (
    "id: staging-pack\n"
    "name: Staging\n"
    "version: 1\n"
    "settings:\n"
    "  presetField: preset\n"
    "  presets:\n"
    "    - id: a\n"
    "      label: A\n"
    "      values: {bogus: 1, preset: a}\n"
)

MERGED_ONLY_BAD_VIZ = (
    "engine: graph\n"
    "config:\n"
    "  - key: preset\n"
    "    type: select\n"
    "    values: [[a, A]]\n"
    "  - key: gain\n"
    "    type: number\n"
    "    min: 0\n"
    "    max: 10\n"
)


def _staging(tmp_path: Path, *, plugin_yml: str, viz: str) -> Path:
    home = tmp_path / "staging"
    home.mkdir()
    (home / "plugin.yml").write_text(plugin_yml, encoding="utf-8")
    (home / "visualisation.yml").write_text(viz, encoding="utf-8")
    return home


def test_settings_check_accepts_valid_merged_staging_tree(tmp_path: Path) -> None:
    merged = plugins.settings_check(_staging(
        tmp_path,
        plugin_yml="id: staging-pack\nname: Staging\nversion: 1\n",
        viz=GOOD_VIZ,
    ))
    assert merged["id"] == "staging-pack"
    assert isinstance(merged.get("visualisation"), dict)


def test_settings_check_rejects_merged_only_invalid_pack(tmp_path: Path) -> None:
    home = _staging(tmp_path, plugin_yml=MERGED_ONLY_BAD_PLUGIN, viz=MERGED_ONLY_BAD_VIZ)
    plugins.validate_doc(plugins.load_file(home / "plugin.yml"))
    viz = yaml.safe_load((home / "visualisation.yml").read_text(encoding="utf-8"))
    plugins._validate_visualisation_yaml(viz)
    with pytest.raises(ValueError, match="bogus"):
        plugins.settings_check(home)


def test_revert_proof_settings_check_runs_merged_semantics(tmp_path: Path) -> None:
    """Revert: skip _validate_merged_catalog_row in attach → merged-only pack passes.

    E       Failed: DID NOT RAISE <class 'ValueError'>
    """
    with pytest.raises(ValueError, match="bogus"):
        plugins.settings_check(_staging(tmp_path, plugin_yml=MERGED_ONLY_BAD_PLUGIN, viz=MERGED_ONLY_BAD_VIZ))
