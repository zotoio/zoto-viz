from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from service import agent_assets


JPEG = b"\xff\xd8\xff" + b"x" * 40
PNG = b"\x89PNG\r\n\x1a\n" + b"x" * 40


class _Resp:
    def __init__(self, status: int, headers: dict[str, str], body: bytes) -> None:
        self.status = status
        self.headers = headers
        self._body = body

    async def read(self) -> bytes:
        return self._body

    async def __aenter__(self) -> _Resp:
        return self

    async def __aexit__(self, *_a: object) -> None:
        return None


class _Sess:
    def __init__(self, resp: _Resp) -> None:
        self.resp = resp
        self.urls: list[str] = []

    async def __aenter__(self) -> _Sess:
        return self

    async def __aexit__(self, *_a: object) -> None:
        return None

    def get(self, url: str, **_k: object) -> _Resp:
        self.urls.append(url)
        return self.resp


def test_photo_cap_fits_nasa_originals() -> None:
    assert agent_assets.MAX_BYTES >= 24_000_000
    assert agent_assets.FETCH_S >= 30
    assert agent_assets.FETCH_TRIES >= 3
    assert agent_assets.MAX_REDIRECTS >= 5


def test_check_url_https_public(monkeypatch) -> None:
    monkeypatch.setattr(agent_assets.socket, "getaddrinfo", lambda *a, **k: [
        (0, 0, 0, "", ("1.1.1.1", 0)),
    ])
    assert agent_assets.check_url("https://example.com/pic.jpg").startswith("https://")


def test_check_url_rejects_lan_and_http(monkeypatch) -> None:
    monkeypatch.setattr(agent_assets.socket, "getaddrinfo", lambda *a, **k: [
        (0, 0, 0, "", ("192.168.1.9", 0)),
    ])
    with pytest.raises(ValueError):
        agent_assets.check_url("https://evil.example/x")
    with pytest.raises(ValueError):
        agent_assets.check_url("http://example.com/x")
    with pytest.raises(ValueError):
        agent_assets.check_url("https://localhost/x")


def test_find_by_url_hits_cached_photo(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(agent_assets, "assets_dir", lambda: tmp_path)
    monkeypatch.setattr(agent_assets.socket, "getaddrinfo", lambda *a, **k: [
        (0, 0, 0, "", ("1.1.1.1", 0)),
    ])
    aid = "aabbccddeeff0011"
    (tmp_path / f"{aid}.jpg").write_bytes(b"x" * 40)
    agent_assets._write_meta(aid, {
        "id": aid,
        "kind": "photo",
        "mime": "image/jpeg",
        "href": f"/api/ai/assets/{aid}",
        "url": "https://example.com/a.jpg",
        "src": "https://example.com/a.jpg",
    })
    hit = agent_assets.find_by_url("https://example.com/a.jpg")
    assert hit and hit["id"] == aid
    assert agent_assets.find_by_url("https://example.com/missing.jpg") is None
    (tmp_path / f"{aid}.jpg").unlink()
    assert agent_assets.find_by_url("https://example.com/a.jpg") is None


def test_sniff_and_resolve_mime() -> None:
    assert agent_assets.sniff_image_mime(JPEG) == "image/jpeg"
    assert agent_assets.sniff_image_mime(PNG) == "image/png"
    assert agent_assets.sniff_image_mime(b"<html>not a picture</html>" + b" " * 20) is None
    assert agent_assets.resolve_image_mime("application/octet-stream", JPEG) == "image/jpeg"
    with pytest.raises(ValueError, match="not an image"):
        agent_assets.resolve_image_mime("image/jpeg", b"<html>error</html>" + b" " * 20)
    assert agent_assets.image_http_status(ValueError("https url required")) == 400
    assert agent_assets.image_http_status(ValueError("fetch failed (502)")) == 502
    assert agent_assets.image_http_status(TimeoutError("timed out")) == 504


def test_fetch_photo_sniffs_octet_stream(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(agent_assets, "assets_dir", lambda: tmp_path)
    monkeypatch.setattr(agent_assets, "check_url", lambda u: u.strip())
    sess = _Sess(_Resp(200, {"Content-Type": "application/octet-stream"}, JPEG))
    monkeypatch.setattr(agent_assets, "ClientSession", lambda timeout=None: sess)
    row = asyncio.run(agent_assets.fetch_photo("https://example.com/iotd.jpg"))
    assert row["mime"] == "image/jpeg"
    assert (tmp_path / f"{row['id']}.jpg").read_bytes() == JPEG


def test_ensure_photo_coalesces_inflight(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(agent_assets, "assets_dir", lambda: tmp_path)
    monkeypatch.setattr(agent_assets, "check_url", lambda u: u.strip())
    n = {"calls": 0}

    async def once(url: str) -> dict:
        n["calls"] += 1
        await asyncio.sleep(0)
        return {"id": "x", "url": url, "src": url, "mime": "image/jpeg"}

    monkeypatch.setattr(agent_assets, "fetch_photo", once)

    async def both() -> None:
        a, b = await asyncio.gather(
            agent_assets.ensure_photo("https://example.com/a.jpg"),
            agent_assets.ensure_photo("https://example.com/a.jpg"),
        )
        assert a["id"] == b["id"] == "x"

    asyncio.run(both())
    assert n["calls"] == 1


def test_store_svg_and_list(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(agent_assets, "assets_dir", lambda: tmp_path)
    row = agent_assets.store_svg('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    assert row["kind"] == "svg"
    assert (tmp_path / f"{row['id']}.svg").is_file()
    assert any(a["id"] == row["id"] for a in agent_assets.list_assets())
    with pytest.raises(ValueError):
        agent_assets.store_svg("<div></div>")
