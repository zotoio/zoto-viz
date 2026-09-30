"""Pack bundle boundary errors (esbuild allowlist) with operator-facing copy."""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any

from .pack_block_copy import (
    BLOCK_FIX_TAIL,
    PACK_LINT_README,
    SENTENCE_BOUNDARY,
    block_message,
    upgrade_block_message,
)


@dataclass
class PackBundleBoundary:
    pack_id: str
    pack_name: str
    file: str
    import_spec: str
    detail: str = ""

    def to_dict(self) -> dict[str, str]:
        return {
            "error": "pack_boundary",
            "id": self.pack_id,
            "name": self.pack_name,
            "file": self.file,
            "import": self.import_spec,
            "message": format_blocked_message(self),
            "hint": BLOCK_FIX_TAIL,
            # #185: diagnostics only (the log / pack author), never user text.
            "details": boundary_details(self),
        }


def boundary_details(block: PackBundleBoundary) -> str:
    file = block.file or "?"
    imp = block.import_spec or "?"
    extra = f" ({block.detail})" if block.detail else ""
    return f"{file} imports {imp}{extra}; see {PACK_LINT_README}"


def format_upgrade_blocked_message(block: PackBundleBoundary, old_version: str | int | None = None) -> str:
    """Upgrade copy; ``old_version`` is the installed version (None: "the version you had")."""
    name = block.pack_name or block.pack_id or "Plugin"
    return upgrade_block_message(name, SENTENCE_BOUNDARY, old_version)


def format_blocked_message(block: PackBundleBoundary) -> str:
    name = block.pack_name or block.pack_id or "Plugin"
    return block_message(name, SENTENCE_BOUNDARY)


_BOUNDARY_RE = re.compile(r"\{[^{}]*\"type\"\s*:\s*\"pack-bundle-boundary\"[^{}]*\}")


def parse_bundle_stderr(stderr: str) -> dict[str, Any] | None:
    text = (stderr or "").strip()
    if not text:
        return None
    for line in reversed(text.splitlines()):
        line = line.strip()
        if "pack-bundle-boundary" not in line:
            continue
        m = _BOUNDARY_RE.search(line)
        if not m:
            continue
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            continue
    return None


def boundary_from_compile(
    doc: dict[str, Any],
    stderr: str,
) -> PackBundleBoundary | None:
    payload = parse_bundle_stderr(stderr)
    if not payload:
        return None
    pid = str(doc.get("id") or "")
    name = str(doc.get("name") or pid)
    return PackBundleBoundary(
        pack_id=pid,
        pack_name=name,
        file=str(payload.get("file") or ""),
        import_spec=str(payload.get("import") or ""),
        detail=str(payload.get("reason") or ""),
    )


class PackBundleBoundaryError(ValueError):
    def __init__(self, block: PackBundleBoundary) -> None:
        self.block = block
        logging.getLogger(__name__).warning("pack bundle boundary block (%s): %s", block.pack_id, boundary_details(block))
        super().__init__(format_blocked_message(block))
