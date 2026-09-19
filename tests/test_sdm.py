from __future__ import annotations

import base64
import json
from pathlib import Path
import asyncio
import time
from unittest.mock import patch

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from service import sdm


@pytest.fixture(autouse=True)
def _iso(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    user = tmp_path / ".zoto-viz"
    user.mkdir()
    monkeypatch.setattr(sdm.paths, "user_dir", lambda: user)
    sdm.reset_for_tests()
    return user


def test_queue_code_is_exchanged_on_poll() -> None:
    sdm.upsert({
        "enterprise_id": "32c4c2bc-fe0d-461b-b51c-f3885afff2f0",
        "client_id": "cid",
        "client_secret": "sek",
    })
    sdm.queue_code("auth-code")

    async def fake_post(url, fields):
        assert fields["code"] == "auth-code"
        del url
        return {"access_token": "at", "refresh_token": "rt", "expires_in": 3600}

    async def fake_list():
        return []

    async def _inner() -> None:
        with patch.object(sdm, "_post_form", fake_post), patch.object(sdm, "list_devices", fake_list), \
             patch.object(sdm, "pull_events", fake_list):
            await sdm.poll()
        assert sdm.status_payload()["linked"] is True

    asyncio.run(_inner())


def test_pcm_url_and_redacted_status() -> None:
    sdm.upsert({
        "enterprise_id": "32c4c2bc-fe0d-461b-b51c-f3885afff2f0",
        "client_id": "abc.apps.googleusercontent.com",
        "client_secret": "s3cret",
    })
    url = sdm.pcm_url()
    assert url is not None
    assert "32c4c2bc-fe0d-461b-b51c-f3885afff2f0" in url
    assert "abc.apps.googleusercontent.com" in url
    assert "sdm.service" in url
    assert "redirect_uri=https%3A%2F%2Fwww.google.com" in url
    st = sdm.status_payload()
    assert st["has_client_secret"] is True
    assert "s3cret" not in json.dumps(st)
    assert st["linked"] is False
    dumped = Path(sdm.sdm_file()).read_text(encoding="utf-8")
    assert "s3cret" in dumped
    assert oct(sdm.sdm_file().stat().st_mode)[-3:] == "600"


def test_enterprise_id_must_be_uuid() -> None:
    with pytest.raises(ValueError, match="UUID"):
        sdm.upsert({"enterprise_id": "gen-lang-client-0973407358"})


def test_parse_device_and_pubsub_event() -> None:
    cam = sdm.parse_device({
        "name": "enterprises/32c4c2bc-fe0d-461b-b51c-f3885afff2f0/devices/AVPHwNtestCam",
        "type": "sdm.devices.types.CAMERA",
        "traits": {
            "sdm.devices.traits.Info": {"customName": "Kitchen"},
            "sdm.devices.traits.CameraLiveStream": {"supportedProtocols": ["WEB_RTC"]},
        },
        "parentRelations": [{"displayName": "Kitchen"}],
    })
    assert cam is not None
    assert cam["label"] == "Kitchen"
    assert cam["webrtc"] is True
    assert cam["camera"] is True
    hub = sdm.parse_device({
        "name": "enterprises/32c4c2bc-fe0d-461b-b51c-f3885afff2f0/devices/AVPHwNhub",
        "type": "sdm.devices.types.DISPLAY",
        "traits": {
            "sdm.devices.traits.Info": {"customName": "Kitchen"},
            "sdm.devices.traits.CameraLiveStream": {"supportedProtocols": ["WEB_RTC"]},
        },
    })
    assert hub is not None
    assert hub["camera"] is False
    assert hub["type"] == "display"
    payload = {
        "eventId": "evt-1",
        "timestamp": "2026-09-19T08:00:00Z",
        "resourceUpdate": {
            "name": "enterprises/32c4c2bc-fe0d-461b-b51c-f3885afff2f0/devices/AVPHwNtestCam",
            "events": {
                "sdm.devices.events.CameraMotion.Motion": {
                    "eventId": "img-1",
                    "eventSessionId": "sess-1",
                }
            },
        },
    }
    b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
    ev = sdm.parse_pubsub_message({"data": b64})
    assert ev is not None
    assert ev["device"] == "AVPHwNtestCam"
    assert "Motion" in ev["kinds"]
    assert ev["event_id"] == "img-1"


def test_poll_skips_fresh_device_list() -> None:
    sdm.upsert({
        "enterprise_id": "32c4c2bc-fe0d-461b-b51c-f3885afff2f0",
        "client_id": "cid",
        "client_secret": "sek",
    })
    sdm.load()["tokens"] = {"refresh_token": "rt"}
    sdm._devices = [{"id": "cached"}]
    sdm._last_list = time.time()
    n = {"list": 0}

    async def fake_list():
        n["list"] += 1
        return []

    async def fake_pull():
        return []

    async def _inner() -> None:
        with patch.object(sdm, "list_devices", fake_list), patch.object(sdm, "pull_events", fake_pull):
            await sdm.poll()
            await sdm.poll()
        assert n["list"] == 0

    asyncio.run(_inner())


def test_fix_sdp_answer_sendrecv_and_foundation() -> None:
    offer = "v=0\nm=audio 9 UDP/TLS/RTP/SAVPF 111\na=recvonly\nm=video 9 UDP/TLS/RTP/SAVPF 96\na=recvonly\n"
    answer = (
        "v=0\r\n"
        "m=audio 9 UDP/TLS/RTP/SAVPF 111\r\n"
        "a=sendrecv\r\n"
        "m=video 9 UDP/TLS/RTP/SAVPF 96\r\n"
        "a=sendrecv\r\n"
        "a=candidate: 1 udp 1 1.1.1.1 9 typ host\r\n"
    )
    fixed = sdm.fix_sdp_answer(offer, answer)
    assert "a=sendonly" in fixed
    assert "a=sendrecv" not in fixed
    assert "a=candidate:1 1 udp" in fixed


def test_normalize_offer_sdp() -> None:
    assert sdm.normalize_offer_sdp("v=0\r\no=- 1") == "v=0\no=- 1\n"
    with pytest.raises(ValueError, match="offerSdp"):
        sdm.normalize_offer_sdp("  ")


def test_apply_snapshot() -> None:
    msg: dict = {}
    sdm.apply(msg)
    assert "sdm" in msg
    assert msg["sdm"]["gcp_project"] == sdm.DEFAULT_GCP


def test_api_get_and_put() -> None:
    async def _inner() -> None:
        app = web.Application()
        app.router.add_get("/api/sdm", sdm.api_sdm)
        app.router.add_post("/api/sdm", sdm.api_sdm)
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            r = await client.get("/api/sdm")
            body = await r.json()
            assert r.status == 200
            assert body["ok"] is True
            assert body["linked"] is False
            r = await client.post("/api/sdm", json={
                "enterprise_id": "32c4c2bc-fe0d-461b-b51c-f3885afff2f0",
                "client_id": "cid",
                "client_secret": "sek",
            })
            body = await r.json()
            assert body["enterprise_id"] == "32c4c2bc-fe0d-461b-b51c-f3885afff2f0"
            assert body["pcm_url"]
            assert "sek" not in json.dumps(body)
        finally:
            await client.close()

    asyncio.run(_inner())


def test_exchange_code_mocked() -> None:
    sdm.upsert({
        "enterprise_id": "32c4c2bc-fe0d-461b-b51c-f3885afff2f0",
        "client_id": "cid",
        "client_secret": "sek",
    })

    async def fake_post(url, fields):
        del url, fields
        return {
            "access_token": "at",
            "refresh_token": "rt",
            "expires_in": 3600,
            "scope": sdm.SDM_SCOPE,
        }

    async def _inner() -> None:
        with patch.object(sdm, "_post_form", fake_post):
            st = await sdm.exchange_code("auth-code")
        assert st["linked"] is True
        assert sdm.load()["tokens"]["refresh_token"] == "rt"

    asyncio.run(_inner())


def test_webrtc_handler_forwards_offer() -> None:
    sdm.upsert({
        "enterprise_id": "32c4c2bc-fe0d-461b-b51c-f3885afff2f0",
        "client_id": "cid",
        "client_secret": "sek",
    })
    sdm.load()["tokens"] = {"refresh_token": "rt", "access_token": "at", "expiry": 9_999_999_999}
    called: dict = {}

    async def fake_exec(device_id, command, params=None):
        called["id"] = device_id
        called["command"] = command
        called["params"] = params
        return {"answerSdp": "v=0\n", "mediaSessionId": "ms"}

    async def _inner() -> None:
        app = web.Application()
        app.router.add_post("/api/sdm/devices/{id}/webrtc", sdm.api_webrtc)
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            with patch.object(sdm, "execute_command", fake_exec):
                r = await client.post(
                    "/api/sdm/devices/AVPHwNcam/webrtc",
                    json={"offerSdp": "v=0\no=- 1"},
                )
                body = await r.json()
            assert r.status == 200
            assert body["answerSdp"] == "v=0\n"
            assert called["command"].endswith("GenerateWebRtcStream")
            assert called["params"]["offerSdp"].endswith("\n")
        finally:
            await client.close()

    asyncio.run(_inner())
