"""Plugin id pattern: lowercase slug (shared with block-store filenames)."""
from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

from service import plugins

PACK_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*$")

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "plugins" / "src"
STARTER = ROOT / "plugins" / "sdk" / "starter"


def _collect_shipped_ids() -> list[tuple[str, Path]]:
    out: list[tuple[str, Path]] = []
    if SRC.is_dir():
        for yml in sorted(SRC.glob("*/plugin.yml")):
            doc = yaml.safe_load(yml.read_text(encoding="utf-8")) or {}
            pid = str(doc.get("id") or yml.parent.name)
            out.append((pid, yml.parent))
    if STARTER.is_dir():
        for yml in STARTER.rglob("plugin.yml"):
            doc = yaml.safe_load(yml.read_text(encoding="utf-8")) or {}
            pid = str(doc.get("id") or yml.parent.name)
            out.append((pid, yml))
    return out


def test_shipped_and_starter_pack_ids_match_lowercase_slug_pattern() -> None:
    rows = _collect_shipped_ids()
    assert rows, "expected plugins/src and/or starter plugin.yml trees"
    bad = [(pid, loc) for pid, loc in rows if not PACK_ID_PATTERN.fullmatch(pid)]
    assert not bad, f"pack ids outside {PACK_ID_PATTERN.pattern!r}: {bad!r}"


@pytest.mark.parametrize(
    "doc_id",
    ["../x", "a/b", "x.json", "Koi", "bad_underscore"],
)
def test_schema_rejects_nonconforming_plugin_ids(doc_id: str) -> None:
    doc = {"id": doc_id, "name": "Probe", "version": 1}
    with pytest.raises(ValueError, match="id"):
        plugins.validate_doc(doc)
