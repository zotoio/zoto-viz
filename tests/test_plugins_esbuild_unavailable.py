"""#169: a TS pack that can't be bundled stays in the catalog as an unavailable row.

esbuild is hidden the way it goes missing in production: bundle-pack-entry.mjs runs from a temp
copy of ``web/scripts`` whose ``web/node_modules`` has no esbuild, so node's own ``import("esbuild")``
fails with "Cannot find package 'esbuild'". No env flag, no stubbed subprocess.
"""
from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Any

import pytest
import yaml

from service import hooks, mcp, plugin_catalog, plugins

REPO = plugins.REPO
SRC = REPO / "plugins" / "src"
ESBUILD_PKG = REPO / "web" / "node_modules" / "esbuild"

pytestmark = pytest.mark.skipif(
    not (ESBUILD_PKG / "package.json").is_file() or not plugins._PACK_BUNDLE_SCRIPT.is_file(),
    reason="needs web/node_modules/esbuild (pnpm install in web/)",
)


def _hidden_esbuild_web(tmp: Path) -> Path:
    """A copy of web/scripts next to a web/node_modules with no esbuild. Returns the script path."""
    (tmp / "web" / "scripts").mkdir(parents=True)
    (tmp / "web" / "node_modules").mkdir()
    (tmp / "plugins").mkdir()
    (tmp / "plugins" / "sdk").symlink_to(REPO / "plugins" / "sdk")
    for name in ("bundle-pack-entry.mjs", "pack-install-lint-gate.mjs"):
        shutil.copy2(REPO / "web" / "scripts" / name, tmp / "web" / "scripts" / name)
    return tmp / "web" / "scripts" / "bundle-pack-entry.mjs"


@pytest.fixture
def no_esbuild(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    script = _hidden_esbuild_web(tmp_path / "noesb")
    monkeypatch.setattr(plugins, "_PACK_BUNDLE_SCRIPT", script)
    plugins.reset_bundles()
    yield script
    plugins.reset_bundles()


def _shipped_ts_ids() -> set[str]:
    """Every plugins/src pack whose TS frontend goes through esbuild (``frontend.bundle`` not false)."""
    out: set[str] = set()
    for yml in sorted(SRC.glob("*/plugin.yml")):
        doc = plugins.load_file(yml)
        fe = doc.get("frontend") if isinstance(doc.get("frontend"), dict) else {}
        if plugins.has_frontend_part(doc, yml.parent, nested=True) and fe.get("bundle") is not False:
            out.add(str(doc["id"]))
    return out


def _shipped_ids() -> set[str]:
    return {str(yaml.safe_load(p.read_text())["id"]) for p in SRC.glob("*/plugin.yml")}


def _setup_warnings(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [
        r for r in caplog.records
        if r.name == "service.plugins" and r.levelno == logging.WARNING and "esbuild unavailable" in r.getMessage()
    ]


def test_hidden_esbuild_keeps_every_ts_pack_unavailable_with_one_warning_per_scan(
    no_esbuild: Path, caplog: pytest.LogCaptureFixture,
) -> None:
    ts_ids = _shipped_ts_ids()
    assert len(ts_ids) >= 20, ts_ids
    caplog.set_level(logging.WARNING, logger="service.plugins")
    result = plugins.scan()
    rows = {u["id"]: u for u in result["unavailable"]}
    missing = sorted(ts_ids - set(rows))
    assert not missing, f"TS packs dropped instead of kept as unavailable rows: {missing}"
    assert {rows[i]["reason"] for i in ts_ids} == {plugins.UNAVAILABLE_ESBUILD}
    assert all(rows[i]["available"] is False for i in ts_ids)
    assert not ts_ids & {str(p.get("id")) for p in result["plugins"]}, "an unavailable pack is in plugins"
    warns = _setup_warnings(caplog)
    assert len(warns) == 1, [w.getMessage() for w in warns]
    msg = warns[0].getMessage()
    assert f"{len(ts_ids)} TS pack(s)" in msg
    assert all(i in msg for i in ts_ids), msg
    # A second catalog build is a second scan: one more line, never one per pack.
    plugins.reset_scan_memo()
    plugins.scan()
    assert len(_setup_warnings(caplog)) == 2


def test_hidden_esbuild_leaves_python_and_glsl_packs_loaded(no_esbuild: Path) -> None:
    ts_ids = _shipped_ts_ids()
    result = plugins.scan()
    loaded = {str(p.get("id")) for p in result["plugins"]}
    assert loaded == _shipped_ids() - ts_ids
    assert len(loaded) + len(result["unavailable"]) == len(_shipped_ids())


def test_esbuild_present_catalog_is_every_shipped_pack() -> None:
    """Count unchanged vs main (d276d5df also loads all 73 shipped packs): nothing unavailable."""
    plugins.reset_bundles()
    result = plugins.scan()
    assert result["unavailable"] == []
    assert {str(p.get("id")) for p in result["plugins"]} == _shipped_ids()
    assert len(result["plugins"]) == len(_shipped_ids()) == 73


def _two_pack_root(tmp: Path) -> Path:
    """plugins/src with pulse-ts and a copy of it, ``pulse-broken``, whose entry doesn't parse."""
    src = tmp / "cat" / "src"
    shutil.copytree(SRC / "pulse-ts", src / "pulse-ts")
    broken = src / "pulse-broken"
    shutil.copytree(SRC / "pulse-ts", broken)
    yml = broken / "plugin.yml"
    yml.write_text(
        yml.read_text().replace("id: pulse-ts", "id: pulse-broken").replace("name: Pulse TS", "name: Pulse Broken")
    )
    entry = broken / "frontend" / "index.ts"
    entry.write_text(entry.read_text() + "\nexport const = ;\n")
    return tmp / "cat"


def test_one_pack_bundle_failure_is_isolated(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    plugins.reset_bundles()
    caplog.set_level(logging.WARNING, logger="service.plugins")
    result = plugins.scan(_two_pack_root(tmp_path))
    assert [p["id"] for p in result["plugins"]] == ["pulse-ts"]
    assert result["unavailable"] == [{
        "id": "pulse-broken",
        "name": "Pulse Broken",
        "file": str(tmp_path / "cat" / "src" / "pulse-broken" / "plugin.yml"),
        "available": False,
        "reason": plugins.UNAVAILABLE_BUNDLE_FAILED,
        "version": 1,
    }]
    assert not _setup_warnings(caplog), "a pack's own build error is not a setup problem"
    logged = [r.getMessage() for r in caplog.records if "pulse-broken" in r.getMessage()]
    assert len(logged) == 1 and "frontend bundle failed" in logged[0]


def test_reload_after_pnpm_install_recovers_without_restart(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The copy says "then reload": the next scan after node_modules/esbuild appears must pick the pack
    up with no reset_bundles() / restart (failed bundles aren't cached; the memo token sees esbuild)."""
    script = _hidden_esbuild_web(tmp_path / "noesb")
    monkeypatch.setattr(plugins, "_PACK_BUNDLE_SCRIPT", script)
    plugins.reset_bundles()
    root = _two_pack_root(tmp_path)
    shutil.rmtree(root / "src" / "pulse-broken")
    first = plugins.scan(root)
    assert [u["id"] for u in first["unavailable"]] == ["pulse-ts"]
    # `pnpm install` in web/: esbuild appears where node resolves it.
    (script.parent.parent / "node_modules" / "esbuild").symlink_to(ESBUILD_PKG.resolve())
    second = plugins.scan(root)
    assert [p["id"] for p in second["plugins"]] == ["pulse-ts"], second["unavailable"]
    assert second["unavailable"] == []


# --- consumers: an unavailable pack is never loadable anywhere that reads the catalog ---------------

UNAV = "pulse-ts"  # has a TS frontend and a Python backend, so every consumer below could touch it


def test_consumers_skip_unavailable_pack(no_esbuild: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    result = plugins.scan()
    assert UNAV in {u["id"] for u in result["unavailable"]}
    # module.js / sky / assets / access / data-source all resolve through _plugin_row.
    assert plugins._plugin_row(UNAV) is None
    resp = plugins.module_response(UNAV)
    assert resp.status == 404
    # Python backends: hooks.sync is always fed scan()["plugins"].
    synced: list[str] = []
    monkeypatch.setattr(hooks, "sync", lambda rows, allow=None: synced.extend(str(r.get("id")) for r in rows))
    hooks.sync(plugins.scan().get("plugins") or [], allow=plugins.python_allow)
    assert synced and UNAV not in synced
    # Update check and the agent's plugin tools.
    assert plugin_catalog.local_version(UNAV) is None
    assert mcp._plugin_rows(UNAV) == []
    assert UNAV not in {str(r.get("id")) for r in mcp._plugin_rows()}


def test_api_list_carries_unavailable_rows_without_raw_error(no_esbuild: Path) -> None:
    import json

    body = json.loads(plugins.api_list(None).body)  # type: ignore[arg-type]
    row = next(u for u in body["unavailable"] if u["id"] == UNAV)
    assert row == {
        "id": UNAV, "name": "Pulse TS", "file": str(SRC / UNAV / "plugin.yml"),
        "available": False, "reason": "esbuild_unavailable", "version": row.get("version"),
    }
    assert UNAV not in {p.get("id") for p in body["plugins"]}
    assert "esbuild" not in json.dumps(body["errors"])
