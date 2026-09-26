"""Every shipped plugins/src/<id>/ tree must pass merged schema validation."""
from __future__ import annotations

from pathlib import Path

import pytest

from service import plugins

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "plugins" / "src"
EXAMPLE_SAMPLE = ROOT / "examples" / "plugins" / "sample"


def _shipped_homes() -> list[Path]:
    homes = sorted(
        p for p in SRC.iterdir()
        if p.is_dir() and (p / "plugin.yml").is_file()
    )
    if EXAMPLE_SAMPLE.is_dir() and (EXAMPLE_SAMPLE / "plugin.yml").is_file():
        homes.append(EXAMPLE_SAMPLE)
    return homes


@pytest.mark.parametrize("home", _shipped_homes(), ids=lambda p: p.name)
def test_shipped_pack_validates_merged(home: Path) -> None:
    plugins.validate_plugin_home(home)
