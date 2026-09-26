"""Pack id rules — pattern from schema/plugin.schema.json; paths for block store."""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

from . import paths

_SCHEMA = Path(__file__).resolve().parents[1] / "schema" / "plugin.schema.json"


@lru_cache(maxsize=1)
def pack_id_pattern_from_schema() -> str:
    raw = json.loads(_SCHEMA.read_text(encoding="utf-8"))
    pattern = raw.get("properties", {}).get("id", {}).get("pattern")
    if not isinstance(pattern, str) or not pattern:
        raise RuntimeError("schema plugin.id.pattern missing")
    return pattern


PACK_ID_PATTERN = pack_id_pattern_from_schema()
PACK_ID_RE = re.compile(PACK_ID_PATTERN)


def pack_id_valid(pack_id: str) -> bool:
    return bool(PACK_ID_RE.fullmatch(str(pack_id or "").strip()))


def require_pack_id(pack_id: str) -> str:
    pid = str(pack_id or "").strip()
    if not pack_id_valid(pid):
        raise ValueError(f"invalid plugin id {pack_id!r}")
    return pid


def pack_block_path(pack_id: str, *, create_blocks_dir: bool = False) -> Path:
    """Resolved ``blocks/<packId>.json`` that must stay inside the blocks directory."""
    pid = require_pack_id(pack_id)
    blocks = paths.plugin_local_dir(create=create_blocks_dir) / "blocks"
    if create_blocks_dir:
        blocks.mkdir(parents=True, exist_ok=True)
    target = (blocks / f"{pid}.json").resolve()
    base = blocks.resolve()
    if target.parent != base or target.name != f"{pid}.json":
        raise ValueError(f"invalid plugin id {pack_id!r}")
    return target


def iter_installed_pack_ids() -> set[str]:
    """Ids that already occupy catalog, local drop, runtime, or block store."""
    seen: set[str] = set()
    src = paths.repo_root() / "plugins" / "src"
    if src.is_dir():
        for child in src.iterdir():
            if child.is_dir() and (child / "plugin.yml").is_file():
                seen.add(child.name)
    zips = paths.plugin_zips_dir()
    if zips.is_dir():
        for z in zips.glob("*.zip"):
            seen.add(z.stem)
    local = paths.plugin_local_dir(create=False)
    if local.is_dir():
        for z in local.glob("*.zip"):
            seen.add(z.stem)
        blocks = local / "blocks"
        if blocks.is_dir():
            for rec in blocks.glob("*.json"):
                seen.add(rec.stem)
    runtime = paths.plugin_local_runtime_dir(create=False)
    if runtime.is_dir():
        for child in runtime.iterdir():
            if child.is_dir():
                seen.add(child.name)
    repo_runtime = paths.plugin_zips_dir().parent / ".runtime"
    if repo_runtime.is_dir():
        for child in repo_runtime.iterdir():
            if child.is_dir():
                seen.add(child.name)
    return seen


def case_insensitive_pack_id_collision(candidate_id: str) -> str | None:
    """Return the installed id that collides on case-insensitive filesystems, if any."""
    pid = str(candidate_id or "").strip()
    if not pid:
        return None
    fold = pid.casefold()
    for existing in iter_installed_pack_ids():
        if existing.casefold() == fold and existing != pid:
            return existing
    return None


def refuse_case_insensitive_id_collision(candidate_id: str) -> None:
    hit = case_insensitive_pack_id_collision(candidate_id)
    if hit is not None:
        raise ValueError(
            f"plugin id {candidate_id!r} conflicts with installed id {hit!r} "
            "(plugin ids are case-insensitive on this filesystem)"
        )
