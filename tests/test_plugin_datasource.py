from __future__ import annotations

import sys
from pathlib import Path

import pytest

from service import hooks
from service import plugin_backend as pb
from service import plugin_datasource as pds
from service import plugins


COLLECTOR = (
    "def start(host):\n"
    "    host.n = 0\n"
    "def stop(host):\n"
    "    host.stopped = True\n"
    "def emit(host):\n"
    "    host.n = getattr(host, 'n', 0) + 1\n"
    "    return {'pulse_hud': {'n': host.n}}\n"
)

STREAMS = (
    "consumes:\n"
    "  - stream: devices\n"
    "    map:\n"
    "      last_seen: seen\n"
    "  - flows\n"
    "produces:\n"
    "  - pulse_hud\n"
    "bindings:\n"
    "  hud: pulse_hud\n"
)


@pytest.fixture(autouse=True)
def _clean() -> None:
    hooks.reset()
    yield
    hooks.reset()


def _tree(
    tmp_path: Path,
    *,
    name: str = "ds",
    collector: str | None = COLLECTOR,
    streams: str | None = STREAMS,
    backend: str | None = None,
) -> Path:
    home = tmp_path / name
    home.mkdir()
    (home / "plugin.yml").write_text(
        f"id: {name}\nname: {name}\nversion: 1\nengine: graph\nbase: topology\n",
        encoding="utf-8",
    )
    if streams is not None or collector is not None:
        (home / "datasource").mkdir()
    if streams is not None:
        (home / "datasource" / "streams.yml").write_text(streams, encoding="utf-8")
    if collector is not None:
        (home / "datasource" / "collector.py").write_text(collector, encoding="utf-8")
    if backend is not None:
        (home / "backend").mkdir()
        (home / "backend" / "service.py").write_text(backend, encoding="utf-8")
    return home / "plugin.yml"


def _spec(yml: Path) -> dict:
    doc = plugins.load_file(yml)
    extra = {**plugins.service_meta(doc, yml), **pb.artefacts(yml)}
    return {**doc, "file": str(yml), **extra}


def test_parse_streams_and_field_remap(tmp_path: Path) -> None:
    yml = _tree(tmp_path, name="remap", collector=None)
    parsed = pds.parse_streams(yml.parent / "datasource" / "streams.yml")
    assert parsed["consumes"][0] == {"stream": "devices", "map": {"last_seen": "seen"}}
    assert parsed["consumes"][1] == {"stream": "flows", "map": {}}
    assert parsed["produces"][0]["stream"] == "pulse_hud"
    snap = {
        "devices": [{"ip": "10.0.0.1", "last_seen": 9}],
        "flows": [{"a": "x"}],
        "other": 1,
    }
    out = pds.remap_consumes(snap, parsed["consumes"])
    assert out["devices"][0]["seen"] == 9
    assert "last_seen" not in out["devices"][0]
    assert out["flows"] == snap["flows"]
    assert "other" not in out


def test_catalog_exposes_streams_mapping(tmp_path: Path) -> None:
    yml = _tree(tmp_path, name="mapped", collector=None)
    result = plugins.scan(yml.parent.parent)
    row = next(p for p in result["plugins"] if p["id"] == "mapped")
    assert row["streams"]["consumes"][0]["map"]["last_seen"] == "seen"
    assert row["streams"]["produces"][0]["stream"] == "pulse_hud"
    assert row["streams"]["bindings"]["hud"] == "pulse_hud"
    assert "collector_sha256" not in row


def test_collector_gated_and_emits_on_bus(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    yml = _tree(tmp_path, name="bus")
    spec = _spec(yml)
    monkeypatch.delenv("ZOTO_VIZ_PLUGIN_SERVICE", raising=False)
    monkeypatch.setattr(plugins, "CONSENT_FILE", tmp_path / "plugin-consent.yml")
    plugins.grant_consent(spec, "reviewed")
    hooks.sync([spec], allow=plugins.python_allow)
    assert pds.loaded() == {}
    assert "plugin_bus_collector" not in sys.modules

    monkeypatch.setenv("ZOTO_VIZ_PLUGIN_SERVICE", "1")
    hooks.sync([spec], allow=plugins.python_allow)
    assert "bus" in pds.loaded()
    assert "plugin_bus_collector" in sys.modules
    assert "pulse_hud" in pds.produced_streams()
    snap = {"devices": [{"ip": "1.1.1.1", "last_seen": 3}]}
    out = pds.apply_snapshot(dict(snap))
    assert out["pulse_hud"] == {"n": 1}
    assert out["plugin_streams"]["bus"]["devices"][0]["seen"] == 3
    assert snap["devices"][0]["last_seen"] == 3

    hooks.sync([], allow=plugins.python_allow)
    assert pds.loaded() == {}
    assert "plugin_bus_collector" not in sys.modules


def test_collector_without_consent_never_imports(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    yml = _tree(tmp_path, name="deny")
    spec = _spec(yml)
    monkeypatch.setenv("ZOTO_VIZ_PLUGIN_SERVICE", "yes")
    monkeypatch.setattr(plugins, "CONSENT_FILE", tmp_path / "plugin-consent.yml")
    hooks.sync([spec], allow=plugins.python_allow)
    assert pds.loaded() == {}
    assert "plugin_deny_collector" not in sys.modules


def test_collector_sha256_mismatch(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    yml = _tree(tmp_path, name="colhash")
    spec = _spec(yml)
    monkeypatch.setenv("ZOTO_VIZ_PLUGIN_SERVICE", "1")
    monkeypatch.setattr(plugins, "CONSENT_FILE", tmp_path / "plugin-consent.yml")
    plugins.grant_consent(spec, "authored")
    hooks.sync([spec], allow=plugins.python_allow)
    assert "colhash" in pds.loaded()
    py = yml.parent / "datasource" / "collector.py"
    py.write_text(COLLECTOR + "\n# tweak\n", encoding="utf-8")
    edited = _spec(yml)
    assert edited["collector_sha256"] != spec["collector_sha256"]
    assert plugins.consented(edited) is False
    hooks.sync([edited], allow=plugins.python_allow)
    assert "colhash" not in pds.loaded()
    assert "plugin_colhash_collector" not in sys.modules


def test_host_emit_and_undeclared_stream_dropped(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    body = (
        "def start(host):\n"
        "    host.emit('pulse_hud', {'via': 'host'})\n"
        "    host.emit('secret', 1)\n"
        "def emit(host):\n"
        "    return None\n"
    )
    yml = _tree(tmp_path, name="hostemit", collector=body)
    spec = _spec(yml)
    monkeypatch.setenv("ZOTO_VIZ_PLUGIN_SERVICE", "on")
    monkeypatch.setattr(plugins, "CONSENT_FILE", tmp_path / "plugin-consent.yml")
    plugins.grant_consent(spec, "reviewed")
    hooks.sync([spec], allow=plugins.python_allow)
    out = pds.merge_emits({})
    assert out["pulse_hud"] == {"via": "host"}
    assert "secret" not in out
