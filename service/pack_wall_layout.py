"""Validate optional ``wall-layout.yml`` beside shipped packs."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

ALLOWED_MOSAIC_SIZES: frozenset[str] = frozenset({"off", "4", "6", "8"})


def wall_layout_mosaic_error(rel_path: str, value: str) -> str:
    return (
        f'wall-layout.yml {rel_path}: look.mosaic must be one of off, 4, 6, 8 (got "{value}")'
    )


def _validate_look_mosaic(rel_path: str, look: Any) -> None:
    if not isinstance(look, dict):
        return
    raw = look.get("mosaic")
    if raw is None:
        return
    value = str(raw).strip()
    if value in ALLOWED_MOSAIC_SIZES:
        return
    raise ValueError(wall_layout_mosaic_error(rel_path, value))


def validate_wall_layout_doc(doc: Any, *, rel_path: str = "wall-layout.yml") -> None:
    if doc is None:
        return
    if not isinstance(doc, dict):
        raise ValueError(f"wall-layout.yml {rel_path}: root must be a mapping")
    for key, block in doc.items():
        if key.startswith("#") or not isinstance(block, dict):
            continue
        look = block.get("look")
        if look is not None:
            _validate_look_mosaic(f"{rel_path} {key}.look", look)


def validate_wall_layout_file(path: Path) -> None:
    rel = f"{path.parent.name}/wall-layout.yml"
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as e:
        raise ValueError(f"wall-layout.yml {path}: could not read: {e}") from e
    validate_wall_layout_doc(raw, rel_path=rel)


def iter_shipped_wall_layout_files(src_dir: Path) -> list[Path]:
    if not src_dir.is_dir():
        return []
    out: list[Path] = []
    for child in sorted(src_dir.iterdir()):
        if not child.is_dir():
            continue
        candidate = child / "wall-layout.yml"
        if candidate.is_file():
            out.append(candidate)
    return out
