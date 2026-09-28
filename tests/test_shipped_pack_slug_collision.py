"""Shipped plugins/src trees must not collide by hyphen/underscore slug."""
from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from service.shipped_pack_slug import (
    COLLISION_MSG,
    assert_no_shipped_pack_slug_collisions,
    find_shipped_pack_slug_collisions,
)

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "plugins" / "src"


def test_no_shipped_pack_slug_collisions_on_disk() -> None:
    assert find_shipped_pack_slug_collisions(SRC) == []


def test_revert_row_restoring_cpu_pong_dir_triggers_exact_collision_message() -> None:
    """Revert row: copy plugins/src/cpupong → cpu-pong → pytest fails with exact message."""
    dest = SRC / "cpu-pong"
    if dest.exists():
        pytest.skip("cpu-pong already present")
    shutil.copytree(SRC / "cpupong", dest)
    try:
        with pytest.raises(ValueError, match=COLLISION_MSG.format(a="cpu-pong", b="cpupong")):
            assert_no_shipped_pack_slug_collisions(SRC)
    finally:
        shutil.rmtree(dest)
