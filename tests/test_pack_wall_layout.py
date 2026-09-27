"""Shipped pack wall-layout.yml mosaic validation (pytest — runs in CI)."""
from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from service.pack_wall_layout import (
    iter_shipped_wall_layout_files,
    validate_wall_layout_doc,
    validate_wall_layout_file,
    wall_layout_mosaic_error,
)

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "plugins" / "src"
FIXTURE = ROOT / "tests" / "fixtures" / "wall-layout" / "bad-mosaic-16.yml"


@pytest.mark.parametrize("path", iter_shipped_wall_layout_files(SRC), ids=lambda p: p.parent.name)
def test_each_shipped_wall_layout_yaml(path: Path) -> None:
    validate_wall_layout_file(path)


def test_wall_layout_rejects_unknown_mosaic_with_exact_message() -> None:
    doc = yaml.safe_load(FIXTURE.read_text(encoding="utf-8"))
    msg = wall_layout_mosaic_error("tests/fixtures/wall-layout/bad-mosaic-16.yml tile_4x4.look", "16")
    err = ""
    raised = False
    try:
        validate_wall_layout_doc(doc, rel_path="tests/fixtures/wall-layout/bad-mosaic-16.yml")
    except ValueError as exc:
        raised = True
        err = str(exc)
    assert raised and err == msg

