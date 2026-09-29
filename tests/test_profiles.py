from __future__ import annotations

import asyncio
from typing import Any
import json

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
    assert "zoto-viz" in empty["profiles"]
    assert empty["profiles"]["zoto-viz"]["label"] == "zoto viz"
    profiles._write({
        "default": "zoto-viz",
        "profiles": {
            "zoto-viz": {"shipped": True, "label": "zoto viz", "settings": {"theme": "midnight"}},
            "user": {"shipped": False, "label": "user", "settings": {"theme": "matrix"}},
        },
    })
    doc = profiles._read()
    assert doc["fresh"] is False
    assert doc["profiles"]["user"]["settings"]["theme"] == "matrix"
    meta = profiles._meta(doc)
    assert meta["default"] == "zoto-viz"
    assert profiles._id("user-1") == "user-1"
    with pytest.raises(web.HTTPBadRequest):
        profiles._id("NOPE")
    with pytest.raises(web.HTTPBadRequest):
        profiles._settings([])
    assert profiles._settings({"settings": {"a": 1}}) == {"a": 1}


def test_migrates_legacy_netviz_id(tmp_path, monkeypatch) -> None:
    _iso(tmp_path, monkeypatch)
    profiles.FILE.write_text(
        "default: netviz\nprofiles:\n  netviz: {shipped: true, label: netviz, settings: {theme: midnight}}\n  user: {shipped: false, label: user, settings: {theme: matrix}}\n",
        encoding="utf-8",
    )
    doc = profiles._read()
    assert "netviz" not in doc["profiles"]
    assert doc["profiles"]["zoto-viz"]["shipped"] is True
    assert doc["profiles"]["zoto-viz"]["label"] == "zoto viz"
    assert doc["profiles"]["zoto-viz"]["settings"]["theme"] == "midnight"
    assert doc["default"] == "zoto-viz"
    disk = yaml.safe_load(profiles.FILE.read_text(encoding="utf-8"))
    assert "netviz" not in disk["profiles"]
    assert "zoto-viz" in disk["profiles"]
    assert profiles.profile_entry("netviz")["id"] == "zoto-viz"


def test_read_skips_bad_ids_and_repairs_shipped(tmp_path, monkeypatch) -> None:
    _iso(tmp_path, monkeypatch)
    profiles.FILE.write_text("default: missing\nprofiles:\n  BAD: {label: x, settings: {}}\n", encoding="utf-8")
    doc = profiles._read()
    assert "zoto-viz" in doc["profiles"]
    assert doc["default"] == "zoto-viz"
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
        shipped_put = await profiles.api_put(Req({"settings": {}}, pid="zoto-viz"))
        assert shipped_put.status == 403
        reserved = await profiles.api_create(Req({"id": "zoto-viz", "settings": {}}))
        assert reserved.status == 403
        reserved_legacy = await profiles.api_create(Req({"id": "netviz", "settings": {}}))
        assert reserved_legacy.status == 403
        dup = await profiles.api_create(Req({"id": "user", "settings": {}}))
        assert dup.status == 409
        missing = await profiles.api_get(Req(pid="nope"))
        assert missing.status == 404
        default = await profiles.api_default(Req({"id": "user"}))
        assert default.status == 200
        named = await profiles.api_create(Req({"id": "default", "settings": {"theme": "ember"}}))
        assert named.status == 201
        saved = await profiles.api_default(Req({"settings": {"theme": "paper", "dream": True}}))
        assert saved.status == 200
        assert json.loads(saved.body)["id"] == "default"
        assert profiles._read()["profiles"]["default"]["settings"]["theme"] == "paper"
        still = await profiles.api_default(Req({"id": "user"}))
        assert still.status == 200
        assert json.loads(still.body)["default"] == "user"
        refresh = await profiles.api_shipped(Req({"settings": {"theme": "midnight"}}))
        assert refresh.status == 200
        gone = await profiles.api_delete(Req(pid="user"))
        assert gone.status == 200
        no_delete = await profiles.api_delete(Req(pid="zoto-viz"))
        assert no_delete.status == 403
        no_delete_legacy = await profiles.api_delete(Req(pid="netviz"))
        assert no_delete_legacy.status == 403
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


def test_global_seeds_model_and_stores_mic_accept(tmp_path, monkeypatch) -> None:
    _iso(tmp_path, monkeypatch)
    profiles.FILE.write_text(
        "default: user\n"
        "profiles:\n"
        "  zoto-viz: {shipped: true, label: zoto viz, settings: {}}\n"
        "  user:\n"
        "    shipped: false\n"
        "    label: user\n"
        "    settings:\n"
        "      ai: {backend: cursor, model: gemma4, cursorModel: grok-4.7, cycle: false}\n",
        encoding="utf-8",
    )

    async def run() -> None:
        got = await profiles.api_global_get(Req())
        assert got.status == 200
        body = json.loads(got.body)
        assert body["ai"]["cursorModel"] == "grok-4.7"
        assert body["ai"]["backend"] == "cursor"
        assert body["media"] == {}
        disk = yaml.safe_load(profiles.FILE.read_text(encoding="utf-8"))
        assert disk["global"]["ai"]["model"] == "gemma4"
        put = await profiles.api_global_put(Req({"media": {"mic": True, "cam": False}}))
        assert put.status == 200
        stored = json.loads(put.body)
        assert stored["media"] == {"mic": True}
        assert stored["ai"]["cursorModel"] == "grok-4.7"
        cleared = await profiles.api_global_put(Req({"ai": {"backend": "ollama", "model": "gemma4"}}))
        assert json.loads(cleared.body)["media"] == {"mic": True}
        assert json.loads(cleared.body)["ai"]["backend"] == "ollama"
        reserved = await profiles.api_create(Req({"id": "global", "settings": {}}))
        assert reserved.status == 403
        still = yaml.safe_load(profiles.FILE.read_text(encoding="utf-8"))
        assert still["global"]["media"]["mic"] is True
        assert still["global"]["ai"]["model"] == "gemma4"
        assert "global" not in still["profiles"]

    asyncio.run(run())


def test_agent_model_meta(tmp_path, monkeypatch) -> None:
    _iso(tmp_path, monkeypatch)

    async def run() -> None:
        created = await profiles.api_create(Req({
            "id": "gemma4-latest",
            "label": "gemma4:latest",
            "model": "gemma4:latest",
            "settings": {"theme": "aurora"},
        }))
        assert created.status == 201
        assert json.loads(created.body)["model"] == "gemma4:latest"
        got = json.loads((await profiles.api_get(Req(pid="gemma4-latest"))).body)
        assert got["model"] == "gemma4:latest"
        assert got["label"] == "gemma4:latest"
        rows = json.loads((await profiles.api_list(Req())).body)["profiles"]
        row = next(p for p in rows if p["id"] == "gemma4-latest")
        assert row["model"] == "gemma4:latest"
        put = await profiles.api_put(Req({
            "settings": {"theme": "paper"},
            "label": "gemma4",
            "model": "gemma4",
        }, pid="gemma4-latest"))
        assert put.status == 200
        doc = profiles._read()
        assert doc["profiles"]["gemma4-latest"]["model"] == "gemma4"
        assert doc["profiles"]["gemma4-latest"]["label"] == "gemma4"

    asyncio.run(run())
