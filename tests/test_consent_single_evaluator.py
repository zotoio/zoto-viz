"""One consent evaluator: catalog, /pack-assets and every other gate answer from ``consent_state``.

Revert rows (each must go red):
- move the assets hash back after the catalog's consent evaluation in ``_catalog_row``
  -> ``test_every_shipped_row_agrees_*`` (pre-key pass) and the HTTP test fail;
- let ``consented`` / ``/pack-assets`` accept ``stale`` -> ``test_pack_assets_403_for_pre_key_record`` fails;
- put ``maybe_autoconsent`` back inside ``consented`` -> ``NoConsentWritesOnFetchTests`` fail.
"""
from __future__ import annotations

from pathlib import Path

import pytest
from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase

from service import access, live, plugins
from tests.pack_asset_test_util import DEFAULT_FRAME, HOST, NULL, SESSION, make_test_app, pack_url


@pytest.fixture(autouse=True)
def _consent_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    live.reset_for_tests()
    live.set_autoconsent(False)
    monkeypatch.setattr(plugins, "CONSENT_FILE", tmp_path / "plugin-consent.yml")
    plugins.reset_scan_memo()
    yield
    plugins.reset_scan_memo()
    live.reset_for_tests()


def _shipped_rows() -> list[dict]:
    plugins.reset_scan_memo()
    rows = plugins.scan()["plugins"]
    assert rows, "shipped catalog is empty"
    return rows


def _assert_row_agrees(row: dict) -> None:
    """The label the catalog shipped must equal what every gate computes on the finished row."""
    pid = row["id"]
    state = plugins.consent_state(row)
    assert row["consent_state"] == state, pid
    assert row["consent"] == plugins.consent_kind(row), pid
    assert plugins.consented(row) is (state == "granted"), pid
    # The client mounts when the catalog says granted; /pack-assets must then say yes (and vice versa).
    assert (row["consent_state"] == "granted") is plugins.consented(row), pid


def test_every_shipped_row_agrees_without_a_record() -> None:
    for row in _shipped_rows():
        _assert_row_agrees(row)
        if plugins.needs_review(row):
            assert row["consent_state"] == "none", row["id"]


def test_every_shipped_row_agrees_with_a_full_record() -> None:
    for row in _shipped_rows():
        if plugins.needs_review(row):
            plugins.grant_consent(row, "authored")
    rows = _shipped_rows()
    for row in rows:
        _assert_row_agrees(row)
        assert row["consent_state"] == "granted", row["id"]


def test_every_shipped_row_agrees_with_a_pre_key_record() -> None:
    """A record made before a hash key existed (Koi before its GLBs): catalog and gates both say stale."""
    reviewed = [r for r in _shipped_rows() if plugins.needs_review(r)]
    with_assets = [r for r in reviewed if r.get("assets_sha256")]
    assert with_assets, "no shipped pack declares assets; this pass would prove nothing"
    for row in reviewed:
        plugins.grant_consent({k: v for k, v in row.items() if k != "assets_sha256"}, "authored")
    by_id = {r["id"]: r for r in _shipped_rows()}
    for row in by_id.values():
        _assert_row_agrees(row)
    for row in with_assets:
        assert by_id[row["id"]]["consent_state"] == "stale", row["id"]
        assert by_id[row["id"]]["consent"] is None, row["id"]


def _asset_pack(tmp_path: Path) -> tuple[dict, Path]:
    home = tmp_path / "demo-pack"
    (home / "assets").mkdir(parents=True)
    (home / "assets" / "fish.glb").write_bytes(b"glTF-demo")
    (home / "plugin.yml").write_text("id: demo-pack\n", encoding="utf-8")
    doc = {
        "id": "demo-pack", "name": "Demo", "version": 1, "runtime": "typescript",
        "has_frontend": True, "hash": "a" * 64, "origin": "zip",
        "file": str(home / "plugin.yml"),
        "assets": [{"id": "fish", "path": "assets/fish.glb"}],
    }
    return doc, home


class PackAssetsSingleEvaluatorTests(AioHTTPTestCase):
    async def get_application(self) -> web.Application:
        return make_test_app()

    @pytest.fixture(autouse=True)
    def _tmp(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        self._tmp_path = tmp_path
        self._mp = monkeypatch

    async def test_pack_assets_403_for_pre_key_record(self) -> None:
        doc, home = _asset_pack(self._tmp_path)
        plugins.grant_consent(doc, "authored")  # no assets_sha256 in the record
        row = plugins._catalog_row(doc, {}, home, [], "demo-pack/plugin.yml")
        assert row is not None and row["consent_state"] == "stale"
        self._mp.setattr(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None)
        denied = await self.client.get(pack_url("demo-pack", "module.js"), headers=NULL)
        assert denied.status == 403

        plugins.grant_consent(row, "authored")  # fresh OK on the finished row
        row2 = plugins._catalog_row(doc, {}, home, [], "demo-pack/plugin.yml")
        assert row2 is not None and row2["consent_state"] == "granted"
        self._mp.setattr(plugins, "_plugin_row", lambda pid: row2 if pid == "demo-pack" else None)
        self._mp.setattr(plugins, "module_response", lambda _pid: web.Response(text="export {};", content_type="text/javascript"))
        ok = await self.client.get(pack_url("demo-pack", "module.js"), headers=NULL)
        assert ok.status == 200


class NoConsentWritesOnFetchTests(AioHTTPTestCase):
    """QE: with auto-consent ON, fetching a stale/changed/never-approved pack's assets, module.js or
    a sandbox token gets 403 and writes 0 consent records. Auto-consent grants only via the client's
    review path. Revert row: put ``maybe_autoconsent`` back inside ``consented`` -> these go red."""

    async def get_application(self) -> web.Application:
        return make_test_app()

    @pytest.fixture(autouse=True)
    def _tmp(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        self._tmp_path = tmp_path
        self._mp = monkeypatch

    def _consent_bytes(self) -> bytes | None:
        f = plugins.CONSENT_FILE
        return f.read_bytes() if f.exists() else None

    async def _fetch_all(self, pid: str) -> list[int]:
        a = await self.client.get(pack_url(pid, "module.js"), headers=NULL)
        b = await self.client.get(pack_url(pid, "assets/fish.glb"), headers=NULL)
        c = await self.client.post(
            f"/api/pack-assets/token/{pid}",
            headers={**HOST, access.HEADER: SESSION},
            json={"frameId": DEFAULT_FRAME},
        )
        return [a.status, b.status, c.status]

    async def _run(self, prepare) -> None:
        doc, home = _asset_pack(self._tmp_path)
        doc = {**doc, "origin": "src"}  # auto-consent eligible
        prepare(doc, home)
        live.set_autoconsent(True)
        row = plugins._catalog_row(doc, {}, home, [], "demo-pack/plugin.yml")
        assert row is not None
        assert row["consent_state"] != "granted"
        self._mp.setattr(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None)
        self._mp.setattr(plugins, "module_response", lambda _pid: web.Response(text="export {};", content_type="text/javascript"))
        before = self._consent_bytes()
        statuses = await self._fetch_all("demo-pack")
        assert statuses == [403, 403, 403], statuses
        assert self._consent_bytes() == before, "a fetch wrote a consent record"
        assert plugins.consent_state(row) == row["consent_state"]

    async def test_never_approved_pack_fetch_writes_nothing(self) -> None:
        await self._run(lambda doc, home: None)

    async def test_stale_pack_fetch_writes_nothing(self) -> None:
        await self._run(lambda doc, home: plugins.grant_consent(doc, "authored"))  # pre-key record

    async def test_changed_pack_fetch_writes_nothing(self) -> None:
        def prep(doc, home):
            row = plugins._catalog_row(doc, {}, home, [], "demo-pack/plugin.yml")
            plugins.grant_consent({**row, "hash": "0" * 64}, "authored")
        await self._run(prep)


def test_catalog_scan_never_auto_grants(tmp_path: Path) -> None:
    doc, home = _asset_pack(tmp_path)
    doc = {**doc, "origin": "src"}
    live.set_autoconsent(True)
    row = plugins._catalog_row(doc, {}, home, [], "demo-pack/plugin.yml")
    assert row is not None and row["consent_state"] == "none"
    assert not plugins.CONSENT_FILE.exists()
