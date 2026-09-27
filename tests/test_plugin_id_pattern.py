"""Plugin id pattern: lowercase slug (schema is the single source)."""
from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from service import plugins
from service.pack_id import PACK_ID_RE, pack_id_pattern_from_schema

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "plugins" / "src"


def test_pack_id_regex_matches_schema_file() -> None:
    import json

    schema = json.loads((ROOT / "schema" / "plugin.schema.json").read_text(encoding="utf-8"))
    assert pack_id_pattern_from_schema() == schema["properties"]["id"]["pattern"]


def _collect_shipped_ids() -> list[tuple[str, Path]]:
    out: list[tuple[str, Path]] = []
    if SRC.is_dir():
        for yml in sorted(SRC.glob("*/plugin.yml")):
            doc = yaml.safe_load(yml.read_text(encoding="utf-8")) or {}
            pid = str(doc.get("id") or yml.parent.name)
            out.append((pid, yml.parent))
    return out


def test_shipped_pack_ids_match_schema_pattern() -> None:
    rows = _collect_shipped_ids()
    assert rows, "expected plugins/src plugin.yml trees"
    bad = [(pid, loc) for pid, loc in rows if not PACK_ID_RE.fullmatch(pid)]
    assert not bad, f"pack ids outside {PACK_ID_RE.pattern!r}: {bad!r}"


def test_schema_rejects_uppercase_plugin_id() -> None:
    doc = {"id": "Koi", "name": "Probe", "version": 1}
    with pytest.raises(ValueError, match="id"):
        plugins.validate_doc(doc)


@pytest.mark.parametrize(
    "doc_id",
    ["../x", "a/b", "x.json", "bad_underscore"],
)
def test_schema_rejects_nonconforming_plugin_ids(doc_id: str) -> None:
    doc = {"id": doc_id, "name": "Probe", "version": 1}
    with pytest.raises(ValueError, match="id"):
        plugins.validate_doc(doc)


@pytest.mark.parametrize("mode_id", ["bad_underscore"])
def test_schema_rejects_nonconforming_mode_id(mode_id: str) -> None:
    doc = {"id": "probe-pack", "name": "Probe", "version": 1, "mode_id": mode_id}
    with pytest.raises(ValueError, match="mode_id"):
        plugins.validate_doc(doc)


@pytest.mark.parametrize("instance_id", ["bad_underscore"])
def test_schema_rejects_nonconforming_plugin_instance_id(instance_id: str) -> None:
    doc = {
        "id": "probe-pack",
        "name": "Probe",
        "version": 1,
        "instances": [{"id": instance_id}],
    }
    with pytest.raises(ValueError, match="instances"):
        plugins.validate_doc(doc)
