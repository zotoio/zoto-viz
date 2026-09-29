"""Shipped plugins/src trees must not collide by directory slug or plugin.yml id, and must scan non-empty."""
from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from service.shipped_pack_slug import (
    COLLISION_MSG,
    assert_no_shipped_pack_slug_collisions,
    find_shipped_pack_slug_collisions,
    plugin_id_slug_collisions,
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


def _src_plugin_ids() -> list[tuple[str, str]]:
    """(directory, plugin.yml id) for every shipped pack home under plugins/src."""
    import yaml

    rows: list[tuple[str, str]] = []
    for child in sorted(SRC.iterdir()):
        yml = child / "plugin.yml"
        if not child.is_dir() or not yml.is_file():
            continue
        raw = yaml.safe_load(yml.read_text(encoding="utf-8")) or {}
        rows.append((child.name, str(raw.get("id") or child.name)))
    return rows


def test_no_duplicate_plugin_ids_on_disk() -> None:
    """Two plugin.yml files must not share an id (exactly or by hyphen/underscore slug)."""
    by_id: dict[str, list[str]] = {}
    for dirname, pid in _src_plugin_ids():
        by_id.setdefault(pid, []).append(dirname)
    dupes = {pid: dirs for pid, dirs in by_id.items() if len(dirs) > 1}
    assert dupes == {}, f"duplicate plugin.yml ids in plugins/src: {dupes}"
    assert plugin_id_slug_collisions(SRC) == []


def test_default_catalog_scan_lists_every_shipped_pack_without_rejection() -> None:
    """Default scan() must not reject the shipped tree (a slug collision blanks the whole catalog)."""
    from service import plugins

    result = plugins.scan()
    rows = result.get("plugins") or []
    errors = result.get("errors") or []
    assert len(rows) > 0, f"default catalog scan returned 0 plugins: {errors[:3]}"
    collisions = [e for e in errors if "collision" in str(e.get("error", "")).lower()]
    assert collisions == [], collisions
    src_errors = [e for e in errors if str(SRC) in str(e.get("file", ""))]
    assert src_errors == [], src_errors
    ids = [p["id"] for p in rows]
    assert len(ids) == len(set(ids)), "scan() returned duplicate plugin ids"
    missing = sorted({pid for _, pid in _src_plugin_ids()} - set(ids))
    assert missing == [], f"shipped packs missing from default scan(): {missing}"
