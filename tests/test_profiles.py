from __future__ import annotations

import asyncio
from typing import Any

import pytest
import yaml
from aiohttp import web

from service import profiles


class Req:
    def __init__(self, body: Any = None, pid: str = "user") -> None:
        self._body = body
        self.match_info = {"id": pid}

    async def json(self) -> Any:
        if self._body is None:
            raise ValueError("no json")
        return self._body


def _iso(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(profiles, "DIR", tmp_path)
    monkeypatch.setattr(profiles, "FILE", tmp_path / "profiles.yml")


def test_read_write_roundtrip(tmp_path, monkeypatch) -> None:
    _iso(tmp_path, monkeypatch)
    empty = profiles._read()
    assert empty["fresh"] is True
    assert "netviz" in empty["profiles"]
    profiles._write({
        "default": "netviz",
        "profiles": {
            "netviz": {"shipped": True, "label": "netviz", "settings": {"theme": "midnight"}},
            "user": {"shipped": False, "label": "user", "settings": {"theme": "matrix"}},
        },
    })
    doc = profiles._read()
    assert doc["fresh"] is False
    assert doc["profiles"]["user"]["settings"]["theme"] == "matrix"
    meta = profiles._meta(doc)
    assert meta["default"] == "netviz"
    assert profiles._id("user-1") == "user-1"
    with pytest.raises(web.HTTPBadRequest):
        profiles._id("NOPE")
    with pytest.raises(web.HTTPBadRequest):
        profiles._settings([])
    assert profiles._settings({"settings": {"a": 1}}) == {"a": 1}


def test_read_skips_bad_ids_and_repairs_shipped(tmp_path, monkeypatch) -> None:
    _iso(tmp_path, monkeypatch)
    profiles.FILE.write_text("default: missing\nprofiles:\n  BAD: {label: x, settings: {}}\n", encoding="utf-8")
    doc = profiles._read()
    assert "netviz" in doc["profiles"]
    assert doc["default"] == "netviz"
    profiles.FILE.write_text("{broken", encoding="utf-8")
    with pytest.raises(ValueError):
        profiles._read()
    profiles.FILE.write_text("123\n", encoding="utf-8")
    with pytest.raises(ValueError):
        profiles._read()
        profiles.FILE.write_text("profiles: [1]\n", encoding="utf-8")
    with pytest.raises(ValueError):
        profiles._read()


def test_api_list_get_create_put_default_delete(tmp_path, monkeypatch) -> None:
    _iso(tmp_path, monkeypatch)

    async def run() -> None:
        listed = await profiles.api_list(Req())
        assert listed.status == 200
        created = await profiles.api_create(Req({"id": "user", "settings": {"theme": "matrix"}, "make_default": True}))
        assert created.status == 201
        got = await profiles.api_get(Req(pid="user"))
        assert got.status == 200
        put = await profiles.api_put(Req({"settings": {"theme": "paper"}, "label": "mine"}, pid="user"))
        assert put.status == 200
        shipped_put = await profiles.api_put(Req({"settings": {}}, pid="netviz"))
        assert shipped_put.status == 403
        reserved = await profiles.api_create(Req({"id": "netviz", "settings": {}}))
        assert reserved.status == 403
        dup = await profiles.api_create(Req({"id": "user", "settings": {}}))
        assert dup.status == 409
        missing = await profiles.api_get(Req(pid="nope"))
        assert missing.status == 404
        default = await profiles.api_default(Req({"id": "user"}))
        assert default.status == 200
        refresh = await profiles.api_shipped(Req({"settings": {"theme": "midnight"}}))
        assert refresh.status == 200
        gone = await profiles.api_delete(Req(pid="user"))
        assert gone.status == 200
        no_delete = await profiles.api_delete(Req(pid="netviz"))
        assert no_delete.status == 403
        bad_json = await profiles.api_create(Req())
        assert bad_json.status == 400
        missing_put = await profiles.api_put(Req({"settings": {}}, pid="ghost"))
        assert missing_put.status == 404
        missing_def = await profiles.api_default(Req({"id": "ghost"}))
        assert missing_def.status == 404
        put_json = await profiles.api_put(Req(pid="user"))
        assert put_json.status == 400
        profiles.FILE.write_text("{", encoding="utf-8")
        listed_bad = await profiles.api_list(Req())
        assert listed_bad.status == 500

    asyncio.run(run())
