"""Pack bundle boundary errors (esbuild allowlist) with operator-facing copy."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

PACK_LINT_README = "plugins/sdk/starter/README.md#2-pack-lint"


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
            "hint": f"Ask the pack author to run pack lint — see {PACK_LINT_README}.",
        }


def format_upgrade_blocked_message(block: PackBundleBoundary, version: str | int | None = None) -> str:
    from .plugin_install import format_v2_blocked_message

    name = block.pack_name or block.pack_id or "Plugin"
    ver = version if version is not None else "2"
    file = block.file or "?"
    imp = block.import_spec or "?"
    detail = f"({file} imports {imp})"
    return format_v2_blocked_message(name, ver, detail)


def format_blocked_message(block: PackBundleBoundary) -> str:
    name = block.pack_name or block.pack_id or "Plugin"
    loc = f" (`{block.file}`)" if block.file else ""
    spec = f" (`{block.import_spec}`)" if block.import_spec else ""
    return (
        f"{name} was blocked: it imports a file outside its own folder{loc}{spec}. "
        "Nothing was installed and the current wall is unchanged. "
        f"Ask the pack author to run pack lint — see {PACK_LINT_README}."
    )


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
        super().__init__(format_blocked_message(block))
