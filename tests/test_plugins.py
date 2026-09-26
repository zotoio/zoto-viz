from __future__ import annotations

from pathlib import Path

import yaml

from service import plugins


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "plugins" / "src"


def test_schema_accepts_shipped_topology() -> None:
    src = SRC / "topology" / "plugin.yml"
    doc = plugins.load_file(src)
    assert doc["id"] == "topology"


def test_schema_accepts_doom() -> None:
    src = SRC / "doom" / "plugin.yml"
    doc = plugins.load_file(src)
    assert doc["id"] == "doom"
    plugins.validate_doc(doc)
    viz = yaml.safe_load((SRC / "doom" / "visualisation.yml").read_text(encoding="utf-8"))
    assert viz["engine"] == "doom"


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
    src = SRC / "pulse-ts" / "plugin.yml"
    doc = plugins.load_file(src)
    assert doc["frontend"]["entry"] == "frontend/index.ts"
    assert doc["backend"]["entry"] == "backend/service.py"
    plugins.validate_doc(doc)


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
    yml.write_text((SRC / "topology" / "plugin.yml").read_text(encoding="utf-8"), encoding="utf-8")
    nested = tmp_path / "pulse-ts"
    nested.mkdir()
    (nested / "plugin.yml").write_text((SRC / "pulse-ts" / "plugin.yml").read_text(encoding="utf-8"), encoding="utf-8")
    found = plugins.plugin_paths(tmp_path)
    assert any(p.name == "ok.yml" for p in found)
    assert any(p.name == "plugin.yml" for p in found)
    assert plugins.plugin_paths(tmp_path / "missing") == []
    assert plugins.plugin_paths(src := yml) == [src]


def test_scan_examples() -> None:
    result = plugins.scan(SRC)
    ids = {p["id"] for p in result["plugins"]}
    assert "topology" in ids
    assert result["schema"].endswith("plugin.schema.json")
    pulse = next((p for p in result["plugins"] if p["id"] == "pulse-ts"), None)
    assert pulse is not None
    assert pulse["service"] == "backend/service.py"


def test_scan_zip_catalog(tmp_path: Path) -> None:
    from service import plugin_zip as pz

    repo = tmp_path / "repo"
    pack = tmp_path / "pack" / "catalog"
    pack.mkdir(parents=True)
    (pack / "plugin.yml").write_text(
        "id: catalog\nname: Catalog\nversion: 1\n", encoding="utf-8",
    )
    (pack / "visualisation.yml").write_text("engine: graph\n", encoding="utf-8")
    zpath = repo / "plugins" / "catalog.zip"
    zpath.parent.mkdir(parents=True)
    pz.pack_tree(pack, zpath)
    result = plugins.scan(repo)
    assert not result["errors"], result["errors"]
    ids = {p["id"] for p in result["plugins"]}
    assert ids == {"catalog"}
    row = result["plugins"][0]
    assert row["origin"] == "zip"
    assert row["zip"] == str(zpath)
    assert "visualisation" in row["parts"]
    assert row.get("visualisation", {}).get("engine") == "graph"
    assert row["sha256"] == pz.plugin_sha256(zpath)
    assert not (repo / "plugins" / "src").exists()
    runtime = repo / "plugins" / ".runtime" / "catalog"
    assert (runtime / "plugin.yml").is_file()
    first_mtime = (runtime / "plugin.yml").stat().st_mtime_ns
    again = plugins.scan(repo)
    assert again["plugins"][0]["sha256"] == row["sha256"]
    assert (runtime / "plugin.yml").stat().st_mtime_ns == first_mtime
    (pack / "plugin.yml").write_text(
        "id: catalog\nname: Catalog\nversion: 2\n", encoding="utf-8",
    )
    pz.pack_tree(pack, zpath)
    plugins.reset_bundles()
    refreshed = plugins.scan(repo)
    assert refreshed["plugins"][0]["version"] == 2
    assert refreshed["plugins"][0]["sha256"] != row["sha256"]


def test_seed_and_validate(tmp_path: Path) -> None:
    first = plugins.seed(tmp_path)
    assert first["copied"] == []
    assert first["skipped"] == []
    code = plugins.cli_validate([str(SRC / "topology")])
    assert code == 0
    assert plugins.bundle_for("missing") is None


def test_cli_zip_deprecated_missing(tmp_path: Path, monkeypatch) -> None:
    repo = tmp_path / "checkout"
    (repo / "plugins").mkdir(parents=True)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    assert plugins.cli_zip_deprecated(str(tmp_path / "missing.zip"), False) == 1


def test_compile_typescript_pulse() -> None:
    src = SRC / "pulse-ts" / "plugin.yml"
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
    class Req:
        match_info = {"id": "pulse-ts"}
    served = plugins.api_module(Req())
    assert served.status == 200
    assert served.content_type == "text/javascript"
    assert served.body
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
    topo = (SRC / "topology" / "plugin.yml").read_text(encoding="utf-8")
    (dup / "a.yml").write_text(topo, encoding="utf-8")
    (dup / "b.yml").write_text(topo, encoding="utf-8")
    scanned = plugins.scan(dup)
    assert scanned["errors"]
    class Req:
        match_info = {"id": "missing"}
    missing = plugins.api_module(Req())
    assert missing.status == 404
    monkeypatch.setattr(plugins, "DIR", tmp_path / "plug")
    listed = plugins.api_list(Req())
    assert listed.status == 200
    empty = tmp_path / "empty-plugins"
    empty.mkdir()
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


def test_autoconsent_flag(tmp_path: Path, monkeypatch) -> None:
    from service import live

    monkeypatch.setattr(plugins, "CONSENT_FILE", tmp_path / "plugin-consent.yml")
    live.reset_for_tests()
    src_ts = {
        "id": "pulse",
        "version": 1,
        "runtime": "typescript",
        "hash": "abc",
        "origin": "src",
    }
    zip_ts = {**src_ts, "id": "contrib", "origin": "zip"}
    local_ts = {**src_ts, "id": "local-pack", "origin": "local"}

    assert plugins.consented(src_ts) is False
    assert plugins.consented(zip_ts) is False

    live.set_autoconsent(True)
    assert plugins.consented(src_ts) is True
    assert plugins.consent_kind(src_ts) == "authored"
    assert plugins.consented(zip_ts) is False
    assert plugins.consented(local_ts) is True
    assert plugins.consent_kind(local_ts) == "reviewed"

    live.set_autoconsent(False)
    stale = {**src_ts, "hash": "def"}
    assert plugins.consented(stale) is False

    live.set_autoconsent(True)
    assert plugins.consented(stale) is True
    assert plugins.consent_kind(stale) == "authored"


def test_api_consent(tmp_path: Path, monkeypatch) -> None:
    import asyncio

    repo = tmp_path / "repo"
    dest = repo / "plugins"
    src = dest / "src" / "review-me"
    src.mkdir(parents=True)
    (src / "plugin.yml").write_text(
        "\n".join(
            [
                "id: review-me",
                "name: Review me",
                "version: 1",
                "engine: graph",
                "base: topology",
                "service: service.py",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (src / "service.py").write_text("def setup(host):\n    pass\n", encoding="utf-8")
    topo = dest / "src" / "topology"
    topo.mkdir(parents=True)
    (topo / "plugin.yml").write_text(
        (SRC / "topology" / "plugin.yml").read_text(encoding="utf-8"), encoding="utf-8",
    )
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
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


