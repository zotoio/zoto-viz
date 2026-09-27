"""Detect shipped ``plugins/src/<dir>/`` trees that collide by hyphen/underscore slug."""
from __future__ import annotations

from pathlib import Path

import yaml

COLLISION_MSG = (
    "shipped catalog collision: pack directories {a!r} and {b!r} "
    "normalize to the same slug"
)


def pack_slug(name: str) -> str:
    return name.replace("-", "").replace("_", "").lower()


def find_shipped_pack_slug_collisions(src_dir: Path) -> list[tuple[str, str]]:
    """Return sorted pairs of directory names that share a normalized slug."""
    if not src_dir.is_dir():
        return []
    by_slug: dict[str, list[str]] = {}
    for child in sorted(src_dir.iterdir()):
        if not child.is_dir() or not (child / "plugin.yml").is_file():
            continue
        key = pack_slug(child.name)
        by_slug.setdefault(key, []).append(child.name)
    out: list[tuple[str, str]] = []
    for names in by_slug.values():
        if len(names) < 2:
            continue
        names = sorted(names)
        for i in range(len(names)):
            for j in range(i + 1, len(names)):
                out.append((names[i], names[j]))
    return out


def assert_no_shipped_pack_slug_collisions(src_dir: Path) -> None:
    pairs = find_shipped_pack_slug_collisions(src_dir)
    if not pairs:
        return
    a, b = pairs[0]
    raise ValueError(COLLISION_MSG.format(a=a, b=b))


def plugin_id_slug_collisions(src_dir: Path) -> list[tuple[str, str, str, str]]:
    """Pairs of (dir_a, id_a, dir_b, id_b) when ids normalize to the same slug."""
    rows: list[tuple[str, str]] = []
    for child in sorted(src_dir.iterdir()):
        if not child.is_dir():
            continue
        yml = child / "plugin.yml"
        if not yml.is_file():
            continue
        raw = yaml.safe_load(yml.read_text(encoding="utf-8"))
        pid = str((raw or {}).get("id") or child.name)
        rows.append((child.name, pid))
    by_slug: dict[str, list[tuple[str, str]]] = {}
    for dirname, pid in rows:
        by_slug.setdefault(pack_slug(pid), []).append((dirname, pid))
    out: list[tuple[str, str, str, str]] = []
    for group in by_slug.values():
        if len(group) < 2:
            continue
        group = sorted(group)
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                da, ia = group[i]
                db, ib = group[j]
                out.append((da, ia, db, ib))
    return out
