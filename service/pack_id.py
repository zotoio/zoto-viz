"""Plugin id pattern — loaded from schema/plugin.schema.json (single source)."""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

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
