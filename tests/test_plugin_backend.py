from __future__ import annotations

import sys
import time
from pathlib import Path

import pytest
import yaml

from service import hooks
from service import plugin_backend as pb
from service import plugin_zip as pz
from service import plugins
from service.plugin_zip import plugin_sha256


BACKEND = (
    "seen = []\n"
    "def setup(host):\n"
    "    host.ticks = 0\n"
    "    seen.append('setup')\n"
    "def teardown(host):\n"
    "    seen.append('teardown')\n"
    "def on_snapshot(host, msg):\n"
    "    host.ticks = getattr(host, 'ticks', 0) + 1\n"
    "    msg.setdefault('plugin_state', {})[host.plugin_id] = {'ticks': host.ticks}\n"
)


@pytest.fixture(autouse=True)
def _clean() -> None:
    hooks.reset()
    yield
    hooks.reset()


def _tree(tmp_path: Path, *, name: str = "pulse", body: str = BACKEND) -> Path:
    home = tmp_path / name
    (home / "backend").mkdir(parents=True)
    yml = home / "plugin.yml"
    yml.write_text(
        f"id: {name}\nname: {name}\nversion: 1\nengine: graph\nbase: topology\n",
        encoding="utf-8",
    )
    (home / "backend" / "service.py").write_text(body, encoding="utf-8")
    return yml


def _spec(yml: Path) -> dict:
    doc = plugins.load_file(yml)
    extra = {**plugins.service_meta(doc, yml), **pb.artefacts(yml)}
    return {**doc, "file": str(yml), **extra}


def test_artefacts_hash_backend(tmp_path: Path) -> None:
    yml = _tree(tmp_path)
    extra = pb.artefacts(yml)
    assert extra["backend_sha256"] == plugin_sha256(yml.parent / "backend" / "service.py")
    assert pb.module_name("pulse", yml.parent / "backend" / "service.py") == "plugin_pulse_backend"


def test_hot_load_setup_snapshot_teardown(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    yml = _tree(tmp_path, name="hosty")
    spec = _spec(yml)
    monkeypatch.setenv("ZOTO_VIZ_PLUGIN_SERVICE", "1")
    monkeypatch.setattr(plugins, "CONSENT_FILE", tmp_path / "plugin-consent.yml")
    plugins.grant_consent(spec, "reviewed")
    hooks.sync([spec], allow=plugins.python_allow)
    assert "hosty" in hooks.loaded()
    assert "plugin_hosty_backend" in sys.modules
    msg = hooks.on_snapshot({"devices": [{"ip": "1.1.1.1"}], "capture": "ring"})
    assert msg["plugin_state"]["hosty"]["ticks"] == 1
    assert msg["capture"] == "ring"
    assert msg["devices"][0]["ip"] == "1.1.1.1"
    hooks.sync([], allow=plugins.python_allow)
    assert hooks.loaded() == {}
    assert "plugin_hosty_backend" not in sys.modules


def test_gate_without_env_never_imports(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    yml = _tree(tmp_path, name="noenv")
    spec = _spec(yml)
    monkeypatch.delenv("ZOTO_VIZ_PLUGIN_SERVICE", raising=False)
    monkeypatch.setattr(plugins, "CONSENT_FILE", tmp_path / "plugin-consent.yml")
    plugins.grant_consent(spec, "authored")
    hooks.sync([spec], allow=plugins.python_allow)
    assert hooks.loaded() == {}
    assert "plugin_noenv_backend" not in sys.modules


def test_gate_without_consent_never_imports(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    yml = _tree(tmp_path, name="nocon")
    spec = _spec(yml)
    monkeypatch.setenv("ZOTO_VIZ_PLUGIN_SERVICE", "true")
    monkeypatch.setattr(plugins, "CONSENT_FILE", tmp_path / "plugin-consent.yml")
    hooks.sync([spec], allow=plugins.python_allow)
    assert hooks.loaded() == {}
    assert "plugin_nocon_backend" not in sys.modules


def test_sha256_mismatch_refuses_reload(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    yml = _tree(tmp_path, name="stale")
    spec = _spec(yml)
    monkeypatch.setenv("ZOTO_VIZ_PLUGIN_SERVICE", "1")
    monkeypatch.setattr(plugins, "CONSENT_FILE", tmp_path / "plugin-consent.yml")
    plugins.grant_consent(spec, "reviewed")
    hooks.sync([spec], allow=plugins.python_allow)
    assert "stale" in hooks.loaded()
    py = yml.parent / "backend" / "service.py"
    py.write_text(BACKEND + "\n# edited\n", encoding="utf-8")
    time.sleep(0.02)
    py.touch()
    edited = _spec(yml)
    assert edited["backend_sha256"] != spec["backend_sha256"]
    assert plugins.consented(edited) is False
    hooks.sync([edited], allow=plugins.python_allow)
    assert "stale" not in hooks.loaded()
    assert "plugin_stale_backend" not in sys.modules
    rec = yaml.safe_load((tmp_path / "plugin-consent.yml").read_text(encoding="utf-8"))
    assert rec["stale"]["backend_sha256"] == spec["backend_sha256"]
    plugins.grant_consent(edited, "reviewed")
    hooks.sync([edited], allow=plugins.python_allow)
    assert "stale" in hooks.loaded()


def test_catalog_scan_attaches_backend_hash(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    yml = _tree(repo / "plugins" / "src", name="scanned")
    result = plugins.scan(repo)
    assert not result["errors"], result["errors"]
    row = next(p for p in result["plugins"] if p["id"] == "scanned")
    assert row["origin"] == "src"
    assert row["service"] == "backend/service.py"
    assert row["backend_sha256"]
    assert "streams" not in row
    assert not (repo / "plugins" / ".runtime" / "scanned").exists()
    assert yml.is_file()


def test_catalog_scan_zip_only_attaches_backend_hash(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    yml = _tree(tmp_path / "pack", name="scanned")
    dest = repo / "plugins" / "scanned.zip"
    dest.parent.mkdir(parents=True)
    pz.pack_tree(yml.parent, dest)
    result = plugins.scan(repo)
    assert not result["errors"], result["errors"]
    row = next(p for p in result["plugins"] if p["id"] == "scanned")
    assert row["origin"] == "zip"
    assert row["zip"] == str(dest)
    assert row["service"] == "backend/service.py"
    assert row["backend_sha256"]
    assert "streams" not in row
    assert not (repo / "plugins" / "src").exists()
    assert (repo / "plugins" / ".runtime" / "scanned" / "backend" / "service.py").is_file()
