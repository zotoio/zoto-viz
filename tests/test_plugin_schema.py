from __future__ import annotations

import json
from pathlib import Path

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError
import pytest

from service import plugins


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "schema" / "plugin.schema.json"

ALLOWED_UNIFORMS = ("uTime", "uOpacity", "uBright", "uAudio", "uAccent", "uBg")
EXCLUDED_UNIFORMS = ("uMode", "uMotif", "uA", "uB", "uWarp", "uGrain", "uBands")

MINIMAL = {"id": "pulse", "name": "Pulse", "version": 1}

MAX_PLUGIN = {
    "id": "harbour",
    "name": "Harbour",
    "version": 1,
    "description": "Talkers as berths.",
    "hint": "LAN as a night harbour.",
    "frontend": {"entry": "frontend/index.ts"},
    "backend": {"entry": "backend/service.py"},
    "capabilities": ["graph.read", "graph.style", "ui.overlay", "config.read"],
    "overlay": True,
    "mode_id": "talkers",
    "datasource": {
        "consumes": [{"stream": "devices", "map": {"rate": "bytes_out"}}, "flows"],
        "produces": [{"stream": "hud"}, "plugin_state"],
    },
    "engine": "doom",
    "base": "cpu",
    "look": {"theme": "tactical", "arcadeId": "doom", "graphBase": "cpu"},
    "style": {"nodeColor": "heat"},
    "layout": {"lanShell": 80},
    "options": {"group": "each"},
    "config": {"sens": 1},
}

MAX_VISUALISATION = {
    "engine": "doom",
    "base": "cpu",
    "look": {"theme": "tactical", "backdrop": "none", "themeCycle": "off"},
    "style": {"nodeColor": "heat", "flatten": True},
    "layout": {"lanShell": 120, "internetShell": 400},
    "options": [
        {
            "key": "group",
            "label": "group",
            "default": "each",
            "values": [["each", "each"]],
        }
    ],
    "config": {"follow": True},
}

MAX_SKY = {
    "recipe": {
        "name": "harbour",
        "motif": 0,
        "a": [0.15, 0.42, 0.85],
        "b": [0.85, 0.55, 0.2],
        "warp": 0.45,
        "grain": 0.25,
        "bands": 4,
    },
    "pins": {"backdrop": "dynamic"},
    "notes": "Hand-authored harbour wash.",
}

MAX_STREAMS = {
    "consumes": [{"stream": "devices", "map": {"rate": "bytes_out"}}, "flows", "feed"],
    "produces": ["graph", {"stream": "hud"}, "plugin_state"],
    "bindings": {"hud": "plugin_state"},
}

MAX_ZIP = {
    "members": [
        "plugin.yml",
        "visualisation.yml",
        "frontend/index.ts",
        "frontend/index.test.ts",
        "sky/sky.yml",
        "sky/fragment.glsl",
        "datasource/streams.yml",
        "datasource/collector.py",
        "backend/service.py",
        "readme.md",
    ],
    "compressedBytes": 12_000,
    "uncompressedBytes": 40_000,
    "fileCount": 10,
    "hasSymlinks": False,
}


def _schema() -> dict:
    raw = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    assert isinstance(raw, dict)
    return raw


def _validator(schema: dict | None = None) -> Draft202012Validator:
    return Draft202012Validator(schema if schema is not None else _schema())


def _def_validator(name: str) -> Draft202012Validator:
    schema = _schema()
    return Draft202012Validator(
        {
            "$schema": schema["$schema"],
            "$id": f"{schema['$id']}#{name}",
            "$ref": f"#/$defs/{name}",
            "$defs": schema["$defs"],
        }
    )


def _messages(err: ValidationError) -> str:
    return err.message


def test_schema_self_check() -> None:
    Draft202012Validator.check_schema(_schema())


def test_minimal_plugin_yml_validates() -> None:
    _validator().validate(MINIMAL)


def test_maximal_plugin_and_parts_validate() -> None:
    _validator().validate(MAX_PLUGIN)
    _def_validator("visualisation").validate(MAX_VISUALISATION)
    _def_validator("sky").validate(MAX_SKY)
    _def_validator("streams").validate(MAX_STREAMS)
    _def_validator("zipListing").validate(MAX_ZIP)


def test_missing_id_rejected() -> None:
    with pytest.raises(ValidationError) as caught:
        _validator().validate({"name": "Pulse", "version": 1})
    assert (
        "id" in _messages(caught.value).lower()
        or "required" in _messages(caught.value).lower()
    )


def test_wrong_version_type_rejected() -> None:
    with pytest.raises(ValidationError) as caught:
        _validator().validate({"id": "pulse", "name": "Pulse", "version": "1"})
    assert (
        "version" in str(caught.value).lower()
        or "integer" in _messages(caught.value).lower()
    )


def test_disallowed_zip_suffix_rejected() -> None:
    listing = {"members": ["plugin.yml", "payload.exe"], "hasSymlinks": False}
    with pytest.raises(ValidationError) as caught:
        _def_validator("zipListing").validate(listing)
    assert (
        "payload.exe" in str(caught.value)
        or "pattern" in _messages(caught.value).lower()
        or "does not match" in _messages(caught.value).lower()
    )


def test_zip_traversal_and_absolute_rejected() -> None:
    zip_v = _def_validator("zipListing")
    with pytest.raises(ValidationError):
        zip_v.validate({"members": ["plugin.yml", "../secret.yml"]})
    with pytest.raises(ValidationError):
        zip_v.validate({"members": ["plugin.yml", "/tmp/x.yml"]})
    with pytest.raises(ValidationError):
        zip_v.validate({"members": ["plugin.yml"], "hasSymlinks": True})


def test_engine_doom_still_validates() -> None:
    _validator().validate(
        {"id": "doom", "name": "Doom", "version": 1, "engine": "doom"}
    )
    _def_validator("visualisation").validate(
        {"engine": "doom", "look": {"theme": "tactical"}}
    )


def test_look_stays_open_and_does_not_gate_absent_keys() -> None:
    schema = json.dumps(_schema())
    for absent in (
        "chromatic",
        "film_noise",
        "film_flicker",
        "halo",
        "drop_amount",
        "cursor_pulse",
        "aim_size",
        "target_size",
        "scanline",
        "follow_zoom",
    ):
        assert absent in schema
    look = _schema()["$defs"]["look"]
    assert look.get("additionalProperties") is True
    assert "required" not in look
    _def_validator("visualisation").validate(
        {"look": {"arcadeId": "doom", "graphBase": "cpu", "unknownKnob": True}}
    )


def test_shader_uniform_contract_lives_in_schema() -> None:
    text = SCHEMA_PATH.read_text(encoding="utf-8")
    for name in ALLOWED_UNIFORMS:
        assert name in text
    for name in EXCLUDED_UNIFORMS:
        assert name in text
    lowered = text.lower()
    assert "exclude" in lowered
    assert "umode" in lowered
    shader = _schema()["$defs"]["shader"]
    assert shader["properties"]["allowedUniforms"]["const"] == list(ALLOWED_UNIFORMS)


def test_catalog_plugin_yml_validates() -> None:
    doom = plugins.load_file(ROOT / "plugins" / "src" / "doom" / "plugin.yml")
    plugins.validate_doc(doom)
    lan = plugins.load_file(ROOT / "plugins" / "src" / "lan-pulse" / "plugin.yml")
    plugins.validate_doc(lan)


def test_viz_contract_in_schema() -> None:
    text = SCHEMA_PATH.read_text(encoding="utf-8")
    assert "vizContract" in text
    assert "vizUboLayout" in text
    assert "viz.read" in text
    assert "viz.write" in text
    assert "graphWalk" in text
    viz = _schema()["$defs"]["vizContract"]
    assert viz["properties"]["graphWalk"]["const"] is False
    ubo = _schema()["$defs"]["vizUboLayout"]
    assert ubo["properties"]["block"]["const"] == "ZotoVizData"
    assert ubo["properties"]["binding"]["const"] == 0
    assert ubo["properties"]["hostUniform"]["const"] == "zotoVizSlots"
    assert ubo["properties"]["totalBytes"]["const"] == 2048


def test_viz_plugin_yml_validates() -> None:
    for pid in ("packet-tunnel", "rf-constellation", "talker-storm",
                "kefrens-bars", "roto-proto", "blob-mesh", "star-sines", "hn-rain", "hn-term",
                "stereo-gram", "syscon", "cypher-cic", "nixie-clock"):
        doc = plugins.load_file(ROOT / "plugins" / "src" / pid / "plugin.yml")
        assert doc["viz"]["graphWalk"] is False
        assert doc["viz"]["idle"]["fixture"] == "host"
        assert "viz.read" in doc["capabilities"]


def test_viz_block_required_with_viz_caps() -> None:
    with pytest.raises(ValueError, match=r"viz"):
        plugins.validate_doc({
            "id": "bad-viz",
            "name": "Bad",
            "version": 1,
            "capabilities": ["viz.read"],
        })


def test_viz_idle_host_fixture_in_schema() -> None:
    text = SCHEMA_PATH.read_text(encoding="utf-8")
    assert "vizIdle" in text
    assert '"fixture"' in text
    _validator().validate({
        "id": "idle-pack",
        "name": "Idle",
        "version": 1,
        "capabilities": ["viz.read", "viz.write"],
        "viz": {
            "graphWalk": False,
            "idle": {"fixture": "host"},
        },
    })


def test_viz_idle_required_with_viz_caps() -> None:
    with pytest.raises(ValueError, match=r"idle"):
        plugins.validate_doc({
            "id": "no-idle",
            "name": "No Idle",
            "version": 1,
            "capabilities": ["viz.write"],
            "viz": {"graphWalk": False},
        })


def test_typesafe_capability_in_schema() -> None:
    caps = _schema()["properties"]["capabilities"]["items"]["enum"]
    assert "typesafe" in caps
    ts = _schema()["$defs"]["typesafeContract"]
    assert "questions" in ts["properties"]
    assert "stateRemap" in ts["properties"]
    _validator().validate({
        "id": "sense-pack",
        "name": "Sense",
        "version": 1,
        "capabilities": ["typesafe"],
        "typesafe": {
            "questions": [{"id": "q1", "prompt": "ping?"}],
            "stateRemap": {"devices": "nodes"},
        },
    })


def test_viz_graph_walk_true_fails_schema() -> None:
    with pytest.raises(ValidationError):
        _validator().validate({
            "id": "bad-walk",
            "name": "Bad",
            "version": 1,
            "capabilities": ["viz.write"],
            "viz": {"graphWalk": True},
        })
    with pytest.raises(ValueError, match="graphWalk"):
        plugins.validate_doc({
            "id": "bad-walk",
            "name": "Bad",
            "version": 1,
            "capabilities": ["viz.write"],
            "viz": {"graphWalk": True},
        })
