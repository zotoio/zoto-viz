"""Batch B: consent records that predate ``assets_sha256`` never mount, and no write path drops it.

Real shipped asset packs (the only four whose ``plugin.yml`` declares ``assets:``), the real catalog
(``scan``/``_plugin_row``), the real ``/pack-assets`` handler (module.js; its root is ``frontend/``),
the real mesh route (``GET /api/plugins/{id}/asset/{path}``) and the real grant endpoint
(``PUT /api/plugins/{id}/consent``). Only ``CONSENT_FILE`` is redirected to ``tmp_path``.

Zoto: Rocket Car Soccer and Host mesh demo hold records without ``assets_sha256`` (made by the old
``_catalog_row`` that judged consent / auto-consented on the half-built row, before assets were hashed).

Revert rows (each must go red):
- move ``consent_state(merged)`` in ``_catalog_row`` above the assets hash block
  -> ``test_pre_key_record_*`` (catalog label says granted while /pack-assets 403s);
- also put ``maybe_autoconsent(merged)`` back on the half-built row there
  -> ``test_autoconsent_*`` (a write lacks ``assets_sha256``).
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase

from service import access, live, plugins
from tests.pack_asset_test_util import HOST, NULL, SESSION, make_test_app, pack_url

ASSET_PACKS = ("aquarium", "host-mesh-demo", "koi-pond", "rocket-car-soccer")
ZOTO_PRE_KEY = ("rocket-car-soccer", "host-mesh-demo")
MUTATE = {**HOST, access.HEADER: SESSION}


@pytest.fixture(autouse=True)
def _consent_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    live.reset_for_tests()
    live.set_autoconsent(False)
    monkeypatch.setattr(plugins, "CONSENT_FILE", tmp_path / "plugin-consent.yml")
    plugins.reset_scan_memo()
    yield
    plugins.reset_scan_memo()
    live.reset_for_tests()


@pytest.fixture()
def writes(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Every consent document persisted, by any path, as a deep copy."""
    seen: list[dict[str, Any]] = []
    real = plugins._persist_consent_doc

    def spy(data: dict[str, Any]) -> None:
        seen.append(json.loads(json.dumps(data)))
        real(data)

    monkeypatch.setattr(plugins, "_persist_consent_doc", spy)
    return seen


def _row(pid: str) -> dict[str, Any]:
    row = plugins._plugin_row(pid)
    assert row is not None, f"{pid} missing from the shipped catalog (esbuild/node_modules?)"
    return row


def _asset_tail(row: dict[str, Any]) -> str:
    assets = row.get("assets") or []
    assert assets, row["id"]
    return str(assets[0]["path"])


def _mesh_url(row: dict[str, Any]) -> str:
    """``/api/plugins/{id}/asset/{path}`` is rooted at ``assets/``."""
    rel = _asset_tail(row)
    assert rel.startswith("assets/"), rel
    return f"/api/plugins/{row['id']}/asset/{rel[len('assets/'):]}"


def _app() -> web.Application:
    app = make_test_app()
    app.router.add_put("/api/plugins/{id}/consent", plugins.api_consent)
    app.router.add_get("/api/plugins/{id}/asset/{path:.+}", plugins.api_asset_http)
    return app


def _record(pid: str) -> dict[str, Any] | None:
    rec = plugins._consent_doc().get(pid)
    return rec if isinstance(rec, dict) else None


def _save_pre_key_record(pid: str) -> dict[str, Any]:
    """What zoto holds today: a full 'authored' record except the assets hash."""
    row = _row(pid)
    assert row.get("assets_sha256"), f"{pid} catalog row lacks assets_sha256"
    plugins.grant_consent({k: v for k, v in row.items() if k != "assets_sha256"}, "authored")
    rec = _record(pid)
    assert rec is not None and "assets_sha256" not in rec
    assert rec["stamp"] == plugins.consent_stamp(row)
    return row


def test_shipped_asset_packs_are_exactly_the_four() -> None:
    plugins.reset_scan_memo()
    rows = plugins.scan()["plugins"]
    with_assets = sorted(r["id"] for r in rows if r.get("assets"))
    assert with_assets == sorted(ASSET_PACKS)
    for pid in ASSET_PACKS:
        row = _row(pid)
        assert row.get("assets_sha256"), pid
        assert plugins.needs_review(row), pid


@pytest.mark.parametrize("pid", ASSET_PACKS)
def test_pre_key_record_reads_stale_and_not_consented(pid: str) -> None:
    _save_pre_key_record(pid)
    row = _row(pid)  # rebuilt: the consent file token busts the scan memo
    assert row["consent_state"] == "stale", pid
    assert row["consent"] is None, pid
    assert plugins.consent_state(row) == "stale", pid
    assert plugins.consent_kind(row) is None, pid
    assert plugins.consented(row) is False, pid


class PreKeyRecordHttpTests(AioHTTPTestCase):
    async def get_application(self) -> web.Application:
        return _app()

    async def _statuses(self, row: dict[str, Any]) -> tuple[int, int]:
        """(/pack-assets module.js, /pack-assets <declared asset path>).

        The mesh route is not asserted 403 here: ``_plugin_enabled_for_serve`` serves ``origin: src``
        meshes without consent (data, not code), so for shipped packs it answers 200 either way.
        """
        pid = row["id"]
        mod = await self.client.get(pack_url(pid, "module.js"), headers=NULL)
        pa = await self.client.get(pack_url(pid, _asset_tail(row)), headers=NULL)
        return mod.status, pa.status

    async def _pre_key_then_regrant(self, pid: str) -> None:
        _save_pre_key_record(pid)
        row = _row(pid)
        # The catalog label must agree with the gate, or the client mounts and /pack-assets 403s.
        assert row["consent_state"] == "stale" and row["consent"] is None, pid
        assert await self._statuses(row) == (403, 403), pid

        resp = await self.client.put(f"/api/plugins/{pid}/consent", headers=MUTATE, json={"kind": "authored"})
        assert resp.status == 200, await resp.text()
        assert (await resp.json()) == {"ok": True, "kind": "authored", "needed": True}

        rec = _record(pid)
        fresh = _row(pid)
        assert rec is not None and rec.get("assets_sha256") == fresh["assets_sha256"], pid
        assert fresh["consent_state"] == "granted", pid
        assert fresh["consent"] == "authored", pid
        assert plugins.consented(fresh) is True, pid

        mod = await self.client.get(pack_url(pid, "module.js"), headers=NULL)
        assert mod.status == 200, (pid, await mod.text())
        assert "javascript" in mod.headers.get("Content-Type", ""), pid
        assert mod.headers.get("X-Zoto-Viz-Hash"), pid
        mesh = await self.client.get(_mesh_url(fresh), headers=HOST)
        assert mesh.status == 200, (pid, await mesh.text())
        assert await mesh.read() == (Path(fresh["file"]).parent / _asset_tail(fresh)).read_bytes()

    async def test_pre_key_record_regrant_rocket_car_soccer(self) -> None:
        await self._pre_key_then_regrant("rocket-car-soccer")

    async def test_pre_key_record_regrant_host_mesh_demo(self) -> None:
        await self._pre_key_then_regrant("host-mesh-demo")

    async def test_pre_key_record_regrant_aquarium(self) -> None:
        await self._pre_key_then_regrant("aquarium")

    async def test_pre_key_record_regrant_koi_pond(self) -> None:
        await self._pre_key_then_regrant("koi-pond")

    async def test_host_mesh_demo_loaded_by_id(self) -> None:
        """``_plugin_row('host-mesh-demo')`` is what /pack-assets and the grant endpoint look up."""
        row = _row("host-mesh-demo")
        assert row["id"] == "host-mesh-demo"
        assert row["origin"] == "src"
        assert Path(row["file"]).parent.name == "host-mesh-demo"
        assert row["consent_state"] == "none"
        assert await self._statuses(row) == (403, 403)


def _assert_every_write_has_assets_hash(writes: list[dict[str, Any]], prior: dict[str, Any] | None = None) -> None:
    """Every record a write adds or changes for an asset pack carries the catalog's assets hash."""
    assert writes, "no consent write happened; this row proves nothing"
    want = {pid: _row(pid)["assets_sha256"] for pid in ASSET_PACKS}
    before: dict[str, Any] = dict(prior or {})
    granted = 0
    for i, doc in enumerate(writes):
        for pid, rec in doc.items():
            if pid in want and rec != before.get(pid):
                granted += 1
                assert rec.get("assets_sha256") == want[pid], (i, pid, sorted(rec))
        before = doc
    assert granted, "no asset-pack record was written; this row proves nothing"


def test_grant_consent_on_catalog_row_records_assets_hash(writes: list[dict[str, Any]]) -> None:
    for pid in ASSET_PACKS:
        plugins.grant_consent(_row(pid), "reviewed")
    _assert_every_write_has_assets_hash(writes)
    for pid in ASSET_PACKS:
        assert _row(pid)["consent_state"] == "granted", pid


def test_autoconsent_server_path_records_assets_hash(writes: list[dict[str, Any]]) -> None:
    """Auto-consent on: build the whole catalog, then ``maybe_autoconsent`` every asset pack."""
    live.set_autoconsent(True)
    plugins.reset_scan_memo()
    rows = {r["id"]: r for r in plugins.scan()["plugins"]}
    for pid in ASSET_PACKS:
        assert plugins.autoconsent_eligible(rows[pid]), pid
        assert plugins.maybe_autoconsent(rows[pid]) is True, pid
    _assert_every_write_has_assets_hash(writes)
    for pid in ASSET_PACKS:
        rec = _record(pid)
        assert rec is not None and rec["kind"] == "authored", pid
        assert rec.get("assets_sha256") == _row(pid)["assets_sha256"], pid
        assert _row(pid)["consent_state"] == "granted", pid


def test_autoconsent_repairs_pre_key_records(writes: list[dict[str, Any]]) -> None:
    for pid in ZOTO_PRE_KEY:
        _save_pre_key_record(pid)
    prior = writes[-1]
    writes.clear()
    live.set_autoconsent(True)
    for pid in ZOTO_PRE_KEY:
        row = _row(pid)
        assert row["consent_state"] == "stale", pid
        assert plugins.maybe_autoconsent(row) is True, pid
    _assert_every_write_has_assets_hash(writes, prior)
    for pid in ZOTO_PRE_KEY:
        assert _row(pid)["consent_state"] == "granted", pid


class AutoconsentClientPathTests(AioHTTPTestCase):
    """The client auto-consents by calling the review endpoint with ``autoconsentKind``."""

    async def get_application(self) -> web.Application:
        return _app()

    @pytest.fixture(autouse=True)
    def _spy(self, writes: list[dict[str, Any]]) -> None:
        self._writes = writes

    async def test_autoconsent_client_path_records_assets_hash_for_all_four(self) -> None:
        live.set_autoconsent(True)
        for pid in ASSET_PACKS:
            kind = plugins.autoconsent_kind(_row(pid))
            resp = await self.client.put(f"/api/plugins/{pid}/consent", headers=MUTATE, json={"kind": kind})
            assert resp.status == 200, (pid, await resp.text())
        _assert_every_write_has_assets_hash(self._writes)
        for pid in ASSET_PACKS:
            row = _row(pid)
            assert row["consent_state"] == "granted", pid
            mod = await self.client.get(pack_url(pid, "module.js"), headers=NULL)
            assert mod.status == 200, pid


class ConsentRefusalBodyTests(AioHTTPTestCase):
    """/pack-assets consent refusals say what they are: ``consent required`` plus the state."""

    async def get_application(self) -> web.Application:
        return make_test_app()

    async def _refusal(self, pid: str, tail: str) -> tuple[int, str]:
        resp = await self.client.get(pack_url(pid, tail), headers=NULL)
        return resp.status, await resp.text()

    async def _assert_refusal(self, pid: str, want_state: str) -> None:
        row = _row(pid)
        assert plugins.consent_state(row) == want_state, pid
        for tail in ("module.js", _asset_tail(row)):
            status, text = await self._refusal(pid, tail)
            assert status == 403, (pid, tail, status)
            assert "origin" not in text.lower(), (pid, tail, text)
            body = json.loads(text)
            assert body.get("error") == "consent required", (pid, tail, body)
            assert body.get("state") == want_state, (pid, tail, body)

    async def test_refusal_body_never_approved(self) -> None:
        await self._assert_refusal("aquarium", "none")

    async def test_refusal_body_pre_key_record_is_stale(self) -> None:
        _save_pre_key_record("rocket-car-soccer")
        await self._assert_refusal("rocket-car-soccer", "stale")

    async def test_refusal_body_changed_record(self) -> None:
        row = _row("koi-pond")
        plugins.grant_consent({**row, "assets_sha256": "0" * 64}, "authored")
        await self._assert_refusal("koi-pond", "changed")
