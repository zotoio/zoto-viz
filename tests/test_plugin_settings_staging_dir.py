"""Pure ``settings_check`` on staging-style directories (#38 → #35 check list)."""
from __future__ import annotations

from pathlib import Path

import pytest

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

BAD_VIZ = (
    "engine: graph\n"
    "settings:\n"
    "  presets:\n"
    "    - id: a\n"
    "      label: A\n"
    "      values: {gain: 1}\n"
    "config:\n"
    "  - key: gain\n"
    "    type: number\n"
    "    min: 0\n"
    "    max: 10\n"
)


def _staging(tmp_path: Path, *, version: int = 1, viz: str) -> Path:
    home = tmp_path / "staging"
    home.mkdir()
    (home / "plugin.yml").write_text(
        f"id: staging-pack\nname: Staging\nversion: {version}\n",
        encoding="utf-8",
    )
    (home / "visualisation.yml").write_text(viz, encoding="utf-8")
    return home


def test_settings_check_accepts_valid_merged_staging_tree(tmp_path: Path) -> None:
    merged = plugins.settings_check(_staging(tmp_path, viz=GOOD_VIZ))
    assert merged["id"] == "staging-pack"
    assert isinstance(merged.get("visualisation"), dict)


def test_settings_check_rejects_merged_only_invalid_pack(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="presetField"):
        plugins.settings_check(_staging(tmp_path, viz=BAD_VIZ))


def test_revert_proof_settings_check_merged_preset_field(tmp_path: Path) -> None:
    """Revert: call validate_doc(plugin.yml only) → invalid merged pack passes.

    E       Failed: DID NOT RAISE <class 'ValueError'>
    """
    with pytest.raises(ValueError, match="presetField"):
        plugins.settings_check(_staging(tmp_path, viz=BAD_VIZ))
