"""Strip TS comments for regex lint (install-time, no Node)."""
from __future__ import annotations

import re

_BLOCK = re.compile(r"/\*[\s\S]*?\*/")
_LINE = re.compile(r"//[^\n]*")


def mask_ts_comments(source: str) -> str:
    return _LINE.sub("", _BLOCK.sub("", source))
