"""Committed all-features sample zip: inspect, parts, pack byte-identity, not in catalog."""
from __future__ import annotations

import json
from pathlib import Path

from jsonschema import Draft202012Validator
import yaml

from service import plugin_sky as psky
from service import plugin_zip as pz
from service import plugins

# Keep in lockstep with tests/test_plugin_sky.py::OK_FRAG
OK_FRAG = """\
void main() {
  vec3 dir = normalize(vDir);
  vec3 col = mix(uBg, uAccent, 0.5 + 0.5 * dir.y);
  fragColor = vec4(col * uBright, uOpacity);
}
"""


ROOT = Path(__file__).resolve().parents[1]
SAMPLE_SRC = ROOT / "examples" / "plugins" / "sample"
SAMPLE_ZIP = ROOT / "examples" / "plugins" / "sample.zip"
OPTIONAL_PARTS = ("visualisation", "frontend", "sky", "datasource", "backend")
SCHEMA_PATH = ROOT / "schema" / "plugin.schema.json"


def _def_validator(name: str) -> Draft202012Validator:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    return Draft202012Validator(
        {
            "$schema": schema["$schema"],
            "$id": f"{schema['$id']}#{name}",
            "$ref": f"#/$defs/{name}",
            "$defs": schema["$defs"],
        }
    )


def test_inspect_src_validates_sample_tree() -> None:
    assert SAMPLE_SRC.is_dir()
    manifest = pz.inspect_src(SAMPLE_SRC)
    plugins.validate_doc(manifest.plugin)
    assert manifest.plugin["id"] == "sample"
    assert set(OPTIONAL_PARTS) <= set(manifest.parts)
    assert "plugin.yml" in manifest.members
    assert "visualisation.yml" in manifest.members
    assert "frontend/index.ts" in manifest.members
    assert "backend/service.py" in manifest.members
    assert "datasource/streams.yml" in manifest.members
    assert "datasource/collector.py" in manifest.members
    assert "sky/sky.yml" in manifest.members
    assert "sky/fragment.glsl" in manifest.members
    assert plugins.cli_validate([str(SAMPLE_SRC)]) == 0


def test_inspect_zip_safety_schema_and_parts() -> None:
    assert SAMPLE_ZIP.is_file()
    assert SAMPLE_ZIP.stat().st_size <= pz.MAX_ZIP_BYTES
    manifest = pz.inspect_zip(SAMPLE_ZIP)
    plugins.validate_doc(manifest.plugin)
    assert manifest.plugin["id"] == "sample"
    assert manifest.compressed_bytes <= pz.MAX_ZIP_BYTES
    assert manifest.uncompressed_bytes <= pz.MAX_UNCOMPRESSED_BYTES
    assert set(OPTIONAL_PARTS) <= set(manifest.parts)
    assert set(OPTIONAL_PARTS) <= set(pz.detect_parts(manifest.members))
    listing = {
        "members": list(manifest.members),
        "compressedBytes": manifest.compressed_bytes,
        "uncompressedBytes": manifest.uncompressed_bytes,
        "fileCount": len(manifest.members),
        "hasSymlinks": False,
    }
    _def_validator("zipListing").validate(listing)
    vis = yaml.safe_load((SAMPLE_SRC / "visualisation.yml").read_text(encoding="utf-8"))
    _def_validator("visualisation").validate(vis)
    sky = yaml.safe_load((SAMPLE_SRC / "sky" / "sky.yml").read_text(encoding="utf-8"))
    _def_validator("sky").validate(sky)
    streams = yaml.safe_load((SAMPLE_SRC / "datasource" / "streams.yml").read_text(encoding="utf-8"))
    _def_validator("streams").validate(streams)
    glsl = (SAMPLE_SRC / "sky" / "fragment.glsl").read_text(encoding="utf-8")
    assert glsl == OK_FRAG
    assert psky.validate_source(glsl) is None
    assert plugins.cli_validate([str(SAMPLE_ZIP)]) == 0


def test_pack_tree_bytes_equal_committed_zip(tmp_path: Path) -> None:
    dest = tmp_path / "sample.zip"
    pz.pack_tree(SAMPLE_SRC, dest)
    assert dest.read_bytes() == SAMPLE_ZIP.read_bytes()
    assert pz.plugin_sha256(dest) == pz.plugin_sha256(SAMPLE_ZIP)


def test_scan_default_has_no_sample_id() -> None:
    result = plugins.scan()
    ids = [p["id"] for p in result["plugins"]]
    assert "sample" not in ids
    assert not (ROOT / "plugins" / "src" / "sample").exists()


def test_sample_readme_is_fixture_not_npm() -> None:
    text = (SAMPLE_SRC / "README.md").read_text(encoding="utf-8").lower()
    assert "fixture" in text
    assert "plugins/src" in text
    assert "npm" not in text
