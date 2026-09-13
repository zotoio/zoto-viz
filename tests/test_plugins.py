from __future__ import annotations

from pathlib import Path

from service import plugins


ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "examples" / "plugins"


def test_schema_accepts_shipped_topology() -> None:
    src = EXAMPLES / "topology.yml"
    doc = plugins.load_file(src)
    assert doc["id"] == "topology"


def test_typescript_requires_entry() -> None:
    bad = {
        "id": "pulse",
        "name": "Pulse",
        "version": 1,
        "engine": "graph",
        "base": "topology",
        "runtime": "typescript",
    }
    try:
        plugins.validate_doc(bad)
    except ValueError:
        return
    raise AssertionError("expected typescript without entry to fail")


def test_pulse_ts_schema() -> None:
    src = EXAMPLES / "pulse-ts" / "plugin.yml"
    doc = plugins.load_file(src)
    assert doc["runtime"] == "typescript"
    assert doc["entry"] == "index.ts"
    plugins.validate_doc({**doc, "service": "service/__init__.py"})


def test_semantics_duplicate_and_default() -> None:
    try:
        plugins._check_semantics({"options": [{"key": "a"}, {"key": "a"}]})
        raise AssertionError("duplicate")
    except ValueError:
        pass
    try:
        plugins._check_semantics({"options": [{"key": "a", "values": [["x", "X"]], "default": "y"}]})
        raise AssertionError("default")
    except ValueError:
        pass
    try:
        plugins._check_semantics({"config": [{"key": "n", "type": "number", "min": 5, "max": 1}]})
        raise AssertionError("min/max")
    except ValueError:
        pass
    plugins._check_semantics({"options": [{"key": "a", "values": [["x", "X"]], "default": "x"}]})


def test_pairs_and_plugin_paths(tmp_path: Path) -> None:
    assert plugins._pairs([["a", "A"], "skip"]) == [["a", "A"]]
    assert plugins._pairs(None) == []
    yml = tmp_path / "ok.yml"
    yml.write_text((EXAMPLES / "topology.yml").read_text(encoding="utf-8"), encoding="utf-8")
    nested = tmp_path / "pulse-ts"
    nested.mkdir()
    (nested / "plugin.yml").write_text((EXAMPLES / "pulse-ts" / "plugin.yml").read_text(encoding="utf-8"), encoding="utf-8")
    found = plugins.plugin_paths(tmp_path)
    assert any(p.name == "ok.yml" for p in found)
    assert any(p.name == "plugin.yml" for p in found)
    assert plugins.plugin_paths(tmp_path / "missing") == []
    assert plugins.plugin_paths(src := yml) == [src]


def test_scan_examples() -> None:
    result = plugins.scan(EXAMPLES)
    ids = {p["id"] for p in result["plugins"]}
    assert "topology" in ids
    assert result["schema"].endswith("view-plugin.schema.json")
    pulse = next((p for p in result["plugins"] if p["id"] == "pulse-ts"), None)
    if pulse:
        assert pulse["service"] == "service/__init__.py"


def test_cli_install_applies_watch(tmp_path: Path, monkeypatch) -> None:
    from service import sysconfig

    dest = tmp_path / "plug"
    dest.mkdir()
    monkeypatch.setattr(plugins, "DIR", dest)
    monkeypatch.setattr(
        sysconfig,
        "ensure",
        lambda: {"ssids": ["HomeNet", "Guest"], "root": "", "hostname": "h", "iface": "wlan0", "monitor_iface": ""},
    )
    monkeypatch.setattr(sysconfig, "write_systemd_override", lambda cfg: None)
    monkeypatch.setattr(sysconfig, "sys_config_file", lambda: tmp_path / "sys-config.yml")
    assert plugins.cli_install(False) == 0
    text = (dest / "air-ssid.yml").read_text(encoding="utf-8")
    assert "default: HomeNet, Guest" in text


def test_seed_and_validate(tmp_path: Path) -> None:
    first = plugins.seed(tmp_path)
    assert first["copied"]
    second = plugins.seed(tmp_path)
    assert second["skipped"]
    forced = plugins.seed(tmp_path, overwrite=True)
    assert forced["copied"]
    code = plugins.cli_validate([str(EXAMPLES / "topology.yml")])
    assert code == 0
    assert plugins.bundle_for("missing") is None


def test_compile_typescript_pulse() -> None:
    src = EXAMPLES / "pulse-ts" / "plugin.yml"
    doc = plugins.load_file(src)
    if not plugins._ESBUILD.is_file():
        try:
            plugins.compile_typescript(doc, src)
        except ValueError as e:
            assert "esbuild" in str(e) or "entry" in str(e)
            return
    extra = plugins.compile_typescript(doc, src)
    assert extra["hash"]
    assert plugins.bundle_for("pulse-ts") is not None
    try:
        plugins.compile_typescript({**doc, "capabilities": ["graph.read", "os.exec"]}, src)
        raise AssertionError("bad caps")
    except ValueError:
        pass


def test_validate_errors_and_api(tmp_path: Path, monkeypatch) -> None:
    try:
        plugins.validate_doc("nope")
        raise AssertionError("mapping")
    except ValueError:
        pass
    bad = tmp_path / "broken.yml"
    bad.write_text("{", encoding="utf-8")
    try:
        plugins.load_file(bad)
        raise AssertionError("yaml")
    except ValueError:
        pass
    assert plugins.compile_typescript({"runtime": "yaml"}, bad) == {}
    try:
        plugins.compile_typescript({"runtime": "typescript", "entry": "x.ts", "id": "x", "capabilities": []}, tmp_path / "x.yml")
        raise AssertionError("dir")
    except ValueError:
        pass
    dup = tmp_path / "dups"
    dup.mkdir()
    (dup / "a.yml").write_text((EXAMPLES / "topology.yml").read_text(encoding="utf-8"), encoding="utf-8")
    (dup / "b.yml").write_text((EXAMPLES / "topology.yml").read_text(encoding="utf-8"), encoding="utf-8")
    scanned = plugins.scan(dup)
    assert scanned["errors"]
    class Req:
        match_info = {"id": "missing"}
    missing = plugins.api_module(Req())
    assert missing.status == 404
    monkeypatch.setattr(plugins, "DIR", tmp_path / "plug")
    listed = plugins.api_list(Req())
    assert listed.status == 200
    assert plugins.cli_install(False) == 0
    empty = tmp_path / "empty-plugins"
    empty.mkdir()
    monkeypatch.setattr(plugins, "DIR", empty)
    assert plugins.cli_validate([]) == 0


def test_python_enabled_and_consent(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("ZOTO_VIZ_PLUGIN_SERVICE", raising=False)
    assert plugins.python_enabled() is False
    monkeypatch.setenv("ZOTO_VIZ_PLUGIN_SERVICE", "1")
    assert plugins.python_enabled() is True
    yaml_only = {"id": "topology", "version": 1}
    assert plugins.needs_review(yaml_only) is False
    assert plugins.consented(yaml_only) is True
    ts = {"id": "pulse", "version": 1, "runtime": "typescript", "hash": "abc"}
    assert plugins.needs_review(ts) is True
    assert plugins.consented(ts) is False
    monkeypatch.setattr(plugins, "CONSENT_FILE", tmp_path / "plugin-consent.yml")
    assert plugins.grant_consent(ts, "reviewed") == "reviewed"
    assert plugins.consent_kind(ts) == "reviewed"
    assert plugins.consented(ts) is True
    assert plugins.python_allow(ts) is True
    stale = {**ts, "hash": "other"}
    assert plugins.consented(stale) is False
    try:
        plugins.grant_consent(ts, "nope")
        raise AssertionError("kind")
    except ValueError:
        pass
    assert (tmp_path / "plugin-consent.yml").stat().st_mode & 0o777 == 0o600


def test_api_consent(tmp_path: Path, monkeypatch) -> None:
    import asyncio

    dest = tmp_path / "plug"
    dest.mkdir()
    (dest / "topology.yml").write_text((EXAMPLES / "topology.yml").read_text(encoding="utf-8"), encoding="utf-8")
    home = dest / "review-me"
    home.mkdir()
    (home / "plugin.yml").write_text(
        "\n".join(
            [
                "id: review-me",
                "name: Review me",
                "version: 1",
                "engine: graph",
                "base: topology",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (home / "service.py").write_text("def setup(host):\n    pass\n", encoding="utf-8")
    monkeypatch.setattr(plugins, "DIR", dest)
    monkeypatch.setattr(plugins, "CONSENT_FILE", tmp_path / "plugin-consent.yml")

    class ConsentReq:
        def __init__(self, pid: str, body) -> None:
            self.match_info = {"id": pid}
            self._body = body

        async def json(self):
            if isinstance(self._body, Exception):
                raise self._body
            return self._body

    bad = asyncio.run(plugins.api_consent(ConsentReq("review-me", ValueError("nope"))))
    assert bad.status == 400
    missing = asyncio.run(plugins.api_consent(ConsentReq("nope", {"kind": "reviewed"})))
    assert missing.status == 404
    skip = asyncio.run(plugins.api_consent(ConsentReq("topology", {"kind": "reviewed"})))
    assert skip.status == 200
    ok = asyncio.run(plugins.api_consent(ConsentReq("review-me", {"kind": "authored"})))
    assert ok.status == 200
    kinded = asyncio.run(plugins.api_consent(ConsentReq("review-me", {"kind": "nope"})))
    assert kinded.status == 400
    obj = asyncio.run(plugins.api_consent(ConsentReq("review-me", [])))
    assert obj.status == 400


