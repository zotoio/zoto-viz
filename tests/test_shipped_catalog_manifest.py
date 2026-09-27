"""Pinned shipped packs must match disk and pass plugin.yml + visualisation.yml schema."""
from __future__ import annotations

from pathlib import Path

import pytest

from service import plugins
from tests.shipped_catalog import PINNED_EXAMPLE_PACK_IDS, PINNED_SHIPPED_PLUGIN_IDS

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "plugins" / "src"
EXAMPLE_SAMPLE = ROOT / "examples" / "plugins" / "sample"


def _disk_src_ids() -> list[str]:
    return sorted(
        p.name for p in SRC.iterdir()
        if p.is_dir() and (p / "plugin.yml").is_file()
    )


def test_shipped_src_ids_match_pinned_list() -> None:
    disk = _disk_src_ids()
    assert disk == list(PINNED_SHIPPED_PLUGIN_IDS)
    assert "marble-run" in disk


@pytest.mark.parametrize("pid", PINNED_SHIPPED_PLUGIN_IDS)
def test_each_shipped_pack_validates_manifest(pid: str) -> None:
    home = SRC / pid
    assert (home / "plugin.yml").is_file(), f"{pid}: missing plugin.yml"
    plugins.validate_plugin_home(home)


@pytest.mark.parametrize("pid", PINNED_EXAMPLE_PACK_IDS)
def test_example_pack_validates_manifest(pid: str) -> None:
    home = EXAMPLE_SAMPLE if pid == "sample" else ROOT / "examples" / "plugins" / pid
    plugins.validate_plugin_home(home)


def test_revert_proof_marble_run_needs_data_mapping_and_work_budget() -> None:
    """Revert row: drop dataMapping/workBudget from schema → marble-run fails with key names."""
    viz_path = SRC / "marble-run" / "visualisation.yml"
    viz = plugins._visualisation_doc(SRC / "marble-run")
    assert viz is not None
    assert "dataMapping" in viz and "workBudget" in viz
    with pytest.raises(Exception) as caught:
        plugins._validate_visualisation_yaml({**viz, "dataMapping": viz["dataMapping"], "workBudget": viz["workBudget"], "bogusKey": 1})
    msg = str(caught.value).lower()
    assert "boguskey" in msg or "additional properties" in msg
