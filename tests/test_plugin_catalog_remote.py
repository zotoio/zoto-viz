from __future__ import annotations

import json

import pytest

from service import plugin_catalog as pc


MANIFEST = {
    "version": 1,
    "plugins": [
        {
            "id": "demo",
            "version": 2,
            "url": "demo-2.zip",
            "sha256": "ab" * 32,
            "description": "demo plugin",
        }
    ],
}


class FakeFetcher(pc.CatalogFetcher):
    def __init__(self, cfg: pc.CatalogConfig, blob: bytes) -> None:
        super().__init__(cfg)
        self._blob = blob

    def fetch_manifest(self) -> bytes:
        return json.dumps(MANIFEST).encode("utf-8")

    def download_plugin(self, url: str) -> bytes:
        assert url == "demo-2.zip"
        return self._blob

    def gh_available(self) -> bool:
        return True

    def gh_authenticated(self) -> bool:
        return True


def _cfg(**kwargs) -> pc.CatalogConfig:
    base = {
        "repo": "acme/plugins",
        "ref": "main",
        "tag": "",
        "release": "",
        "manifest_path": "manifest.json",
        "interval_s": 3600.0,
        "auth": "gh",
        "deploy_key": "~/.zoto-viz/plugin-catalog_deploy_key",
    }
    base.update(kwargs)
    return pc.CatalogConfig(**base)


def test_load_config_from_sysconfig(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(pc.REPO_ENV, raising=False)
    cfg = pc.load_config({
        "plugin_catalog": {
            "repo": "zotoio/private-plugins",
            "interval": 1800,
            "auth": "ssh",
        }
    })
    assert cfg.repo == "zotoio/private-plugins"
    assert cfg.interval_s == 1800.0
    assert cfg.auth == "ssh"


def test_disabled_without_repo() -> None:
    assert pc.disabled(_cfg(repo="")) is True


def test_poll_skips_bad_checksum(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pc, "state_path", lambda: tmp_path / "state.json")
    monkeypatch.setattr(pc, "local_version", lambda _pid: None)
    installed: list[bytes] = []

    def fake_install(blob: bytes, **kwargs):
        installed.append(blob)
        return {"ok": True, "id": "demo", "consentRequired": True, "path": "/tmp/demo.zip"}

    monkeypatch.setattr(pc.plugin_local, "install_local_zip", fake_install)
    monkeypatch.setattr(pc.plugin_local, "notify_catalog", lambda: None)
    cfg = _cfg()
    fetcher = FakeFetcher(cfg, b"wrong-bytes")
    info = pc.poll_once(cfg, fetcher=fetcher)
    assert info["action"] == "polled"
    assert info["results"][0]["action"] == "error"
    assert "sha256" in info["results"][0]["error"]
    assert installed == []


def test_poll_installs_new_version(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pc, "state_path", lambda: tmp_path / "state.json")
    monkeypatch.setattr(pc, "local_version", lambda _pid: 1)
    blob = b"zip-bytes"
    expect = pc._sha256_bytes(blob)
    manifest = {
        "plugins": [{
            "id": "demo",
            "version": 2,
            "url": "demo-2.zip",
            "sha256": expect,
            "description": "x",
        }]
    }

    class Fetch(pc.CatalogFetcher):
        def fetch_manifest(self) -> bytes:
            return json.dumps(manifest).encode()

        def download_plugin(self, url: str) -> bytes:
            return blob

    calls: list[dict] = []

    def fake_install(raw: bytes, **kwargs):
        calls.append(kwargs)
        return {"ok": True, "id": "demo", "consentRequired": True, "path": "/tmp/demo.zip"}

    monkeypatch.setattr(pc.plugin_local, "install_local_zip", fake_install)
    monkeypatch.setattr(pc.plugin_local, "notify_catalog", lambda: None)
    info = pc.poll_once(_cfg(), fetcher=Fetch(_cfg()))
    assert info["results"][0]["action"] == "installed"
    assert calls and calls[0]["activate"] is False


def test_gh_auth_failure_message() -> None:
    def run(cmd, cwd, env):
        if cmd[:2] == ["gh", "auth"]:
            return 1, "", "not logged in"
        return 0, "", ""

    fetcher = pc.CatalogFetcher(_cfg())
    fetcher._run = run
    assert fetcher.gh_authenticated() is False


def test_safe_err_strips_tokens() -> None:
    text = "failed gho_abcdefghijklmnopqrstuvwxyz1234567890"
    cleaned = pc.CatalogFetcher._safe_err(text)
    assert "gho_" not in cleaned
    assert "[token]" in cleaned
