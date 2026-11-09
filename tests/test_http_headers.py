from __future__ import annotations

import asyncio
from typing import Any

import pytest
from yarl import URL

from service import http_headers, sources


def test_user_agent_includes_project_and_repo() -> None:
    ua = http_headers.USER_AGENT
    assert "zoto-viz" in ua
    assert "github.com/zotoio/zoto-viz" in ua


def test_outbound_headers_always_sets_user_agent() -> None:
    h = http_headers.outbound_headers("https://commons.wikimedia.org/w/api.php")
    assert h["User-Agent"] == http_headers.USER_AGENT
    assert http_headers.FEED_ACCEPT in http_headers.feed_session_headers()["Accept"]


def test_is_wikimedia_host() -> None:
    assert http_headers.is_wikimedia_host("https://commons.wikimedia.org/w/api.php")
    assert http_headers.is_wikimedia_host("https://en.wikipedia.org/w/api.php")
    assert not http_headers.is_wikimedia_host("https://apod.nasa.gov/")


def test_http_body_sends_policy_user_agent(monkeypatch: pytest.MonkeyPatch) -> None:
    """Wikimedia 403s without User-Agent; every source GET must send one."""
    captured: dict[str, Any] = {}

    class FakeResponse:
        status = 200
        headers = {"Content-Type": "application/atom+xml"}

        def __init__(self, url: str) -> None:
            self.url = url

        async def read(self) -> bytes:
            return b"<feed xmlns='http://www.w3.org/2005/Atom'/>"

        async def __aenter__(self) -> FakeResponse:
            return self

        async def __aexit__(self, *_: object) -> None:
            return None

    class FakeSession:
        closed = False

        def get(self, url: URL, **kwargs: Any) -> FakeResponse:
            captured["url"] = str(url)
            captured.update(kwargs)
            return FakeResponse(str(url))

    async def fake_session() -> FakeSession:
        return FakeSession()

    monkeypatch.setattr(sources, "session", fake_session)
    url = "https://commons.wikimedia.org/w/api.php?action=featuredfeed&feed=potd&feedformat=atom"
    asyncio.run(sources._http_body(url))
    headers = captured.get("headers") or {}
    assert "github.com/zotoio/zoto-viz" in headers.get("User-Agent", "")
    assert headers.get("Accept") == http_headers.FEED_ACCEPT


def test_feed_session_headers_match_http_body() -> None:
    sess_headers = http_headers.feed_session_headers()
    per_req = http_headers.outbound_headers(
        "https://commons.wikimedia.org/w/api.php", accept=http_headers.FEED_ACCEPT
    )
    assert sess_headers["User-Agent"] == per_req["User-Agent"]
    assert sess_headers["Accept"] == per_req["Accept"]
