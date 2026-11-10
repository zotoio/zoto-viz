"""NOAA SWPC planetary K-index source: recorded fixture, polite polling, offline fallback. No network."""
from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path
from typing import Any

import pytest

from service import noaa_kp, paths, source_consent, sources
from service.source_library import catalog, materialize

FIXTURE = Path(__file__).parent / "fixtures" / "noaa-kp" / "noaa-planetary-k-index.json"
BODY = FIXTURE.read_bytes()


class FakeResponse:
    """``content.read(n)`` behaves like aiohttp's StreamReader: at most one network ``chunk`` per
    call (never more than ``n``), then ``b""`` at EOF."""

    def __init__(self, status: int, body: bytes = b"", headers: dict[str, str] | None = None,
                 *, chunk: int | None = None) -> None:
        self.status = status
        self.headers = headers or {}
        self._body = body
        self._pos = 0
        self._chunk = chunk
        self.reads = 0
        self.content = self

    async def read(self, n: int = -1) -> bytes:
        self.reads += 1
        left = len(self._body) - self._pos
        take = left if n < 0 else min(n, left)
        if self._chunk is not None:
            take = min(take, self._chunk)
        out = self._body[self._pos:self._pos + take]
        self._pos += take
        return out

    async def __aenter__(self) -> FakeResponse:
        return self

    async def __aexit__(self, *exc: object) -> None:
        return None


class FakeSession:
    """Replays queued replies; an Exception entry is raised like a dropped connection."""

    def __init__(self, *replies: FakeResponse | Exception) -> None:
        self.replies = list(replies)
        self.calls: list[dict[str, Any]] = []

    def get(self, url: str, **kw: Any) -> FakeResponse:
        self.calls.append({"url": url, **kw})
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def ok_reply() -> FakeResponse:
    return FakeResponse(200, BODY, {"ETag": '"12c5-65ff"', "Last-Modified": "Tue, 10 Nov 2026 18:18:59 GMT"})


@pytest.fixture(autouse=True)
def _user_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(paths, "user_dir", lambda: tmp_path)
    monkeypatch.setattr(source_consent, "allowed", lambda host: True)
    noaa_kp.reset_for_tests()
    sources.reset_for_tests()
    return tmp_path


def _row(**over: Any) -> dict[str, Any]:
    return sources.normalize({**materialize("noaa-kp")[0], **over})


def test_library_recipe_is_polite_and_off_the_ticker() -> None:
    row = _row()
    assert row["id"] == "noaa-kp" and row["type"] == "http"
    assert noaa_kp.matches(row["url"])
    assert row["feed"] is False
    assert row["interval"] == 900
    assert any(r["id"] == "noaa-kp" and r["vendor"] == "NOAA SWPC" for r in catalog())


def test_interval_never_drops_below_ten_minutes() -> None:
    assert _row(interval=15)["interval"] == noaa_kp.MIN_INTERVAL
    assert _row(interval=3600)["interval"] == 3600
    other = sources.normalize({"id": "x", "type": "http", "url": "https://example.com/k.json", "interval": 15})
    assert other["interval"] == 15


def test_matches_only_the_swpc_product() -> None:
    assert noaa_kp.matches(noaa_kp.URL)
    assert not noaa_kp.matches("http://services.swpc.noaa.gov/products/noaa-planetary-k-index.json")
    assert not noaa_kp.matches("https://services.swpc.noaa.gov/products/noaa-scales.json")
    assert not noaa_kp.matches("https://evil.example/products/noaa-planetary-k-index.json")


def test_recorded_fixture_projects_newest_first() -> None:
    rows = noaa_kp.parse_rows(json.loads(BODY))
    assert len(rows) == 62
    assert rows[-1] == {"time": "2026-11-10T15:00:00Z", "kp": 3.0, "a": 15, "stations": 8}
    summary = noaa_kp.summarize(rows)
    assert summary["kp"] == 3.0 and summary["level"] == "unsettled"
    assert summary["trend"] == pytest.approx(1.67)
    assert summary["max24h"] == 3.0
    assert len(summary["history"]) == noaa_kp.HISTORY and summary["history"][-1] == 3.0
    items = noaa_kp.items(rows)
    assert len(items) == noaa_kp.HISTORY
    assert items[0]["title"] == "Kp 3.00 · unsettled"
    assert items[0]["published"] == "2026-11-10T15:00:00Z"
    assert items[1]["title"].startswith("Kp 1.33")
    assert "24 h max 3.00" in items[0]["summary"]
    assert all(re.match(r"^Kp \d\.\d\d · ", it["title"]) for it in items)
    assert all(it["link"].startswith("https://www.swpc.noaa.gov/") for it in items)


def test_legacy_array_rows_and_bad_rows() -> None:
    legacy = [
        ["time_tag", "Kp", "a_running", "station_count"],
        ["2024-05-10 18:00:00.000", "8.67", "300", "8"],
        ["2024-05-10 21:00:00.000", "9.00", "400", "8"],
        ["garbage"],
        {"time_tag": "2024-05-11T00:00:00", "Kp": "not a number"},
    ]
    rows = noaa_kp.parse_rows(legacy)
    assert [r["kp"] for r in rows] == [8.67, 9.0]
    assert rows[-1]["time"] == "2024-05-10T21:00:00Z"
    assert noaa_kp.summarize(rows)["level"] == "G5 storm"
    with pytest.raises(ValueError):
        noaa_kp.parse_rows({"not": "a list"})
    with pytest.raises(ValueError):
        noaa_kp.parse_rows([])


@pytest.mark.parametrize(("kp", "words"), [
    (0.33, "quiet"), (2.0, "unsettled"), (3.67, "active"), (4.67, "G1 storm"), (6.0, "G2 storm"), (9.0, "G5 storm"),
])
def test_g_scale_words(kp: float, words: str) -> None:
    assert noaa_kp.level(kp) == words


def test_fetch_sends_a_descriptive_user_agent_and_caches() -> None:
    sess = FakeSession(ok_reply())
    payload = asyncio.run(noaa_kp.fetch(sess, now=1000.0))  # type: ignore[arg-type]
    call = sess.calls[0]
    assert call["url"] == noaa_kp.URL and call["allow_redirects"] is False
    ua = call["headers"]["User-Agent"]
    assert "zoto-viz" in ua and "https://github.com/zotoio/zoto-viz" in ua
    assert call["timeout"].total == noaa_kp.FETCH_S
    assert payload["items"][0]["title"].startswith("Kp 3.00")
    assert payload["json"]["kp"] == 3.0 and "stale" not in payload
    cached = json.loads(noaa_kp.cache_file().read_text(encoding="utf-8"))
    assert cached["etag"] == '"12c5-65ff"' and cached["fetchedAt"] == 1000.0


def test_a_body_split_across_network_chunks_is_read_to_the_end() -> None:
    reply = FakeResponse(200, BODY, chunk=500)
    payload = asyncio.run(noaa_kp.fetch(FakeSession(reply), now=1000.0))  # type: ignore[arg-type]
    assert reply.reads > len(BODY) // 500
    assert payload["json"]["kp"] == 3.0 and "stale" not in payload
    assert len(payload["items"]) == noaa_kp.HISTORY


def test_a_body_of_exactly_the_cap_is_accepted() -> None:
    padded = BODY + b" " * (noaa_kp.MAX_BODY - len(BODY))
    payload = asyncio.run(noaa_kp.fetch(FakeSession(FakeResponse(200, padded, chunk=4096)), now=1000.0))  # type: ignore[arg-type]
    assert payload["json"]["kp"] == 3.0


def test_a_chunked_body_over_the_cap_is_refused_without_reading_it_all() -> None:
    huge = b"[" + b" " * (noaa_kp.MAX_BODY * 4) + b"]"
    reply = FakeResponse(200, huge, chunk=4096)
    with pytest.raises(ValueError, match="too large"):
        asyncio.run(noaa_kp.fetch(FakeSession(reply), now=1000.0))  # type: ignore[arg-type]
    assert reply._pos == noaa_kp.MAX_BODY + 1
    assert not noaa_kp.cache_file().exists()


def test_fresh_cache_skips_the_network_after_a_restart() -> None:
    asyncio.run(noaa_kp.fetch(FakeSession(ok_reply()), now=1000.0))  # type: ignore[arg-type]
    noaa_kp.reset_for_tests()
    idle = FakeSession()
    payload = asyncio.run(noaa_kp.fetch(idle, now=1000.0 + noaa_kp.MIN_INTERVAL - 1))  # type: ignore[arg-type]
    assert idle.calls == []
    assert payload["json"]["kp"] == 3.0


def test_revalidates_with_etag_and_reuses_on_304() -> None:
    asyncio.run(noaa_kp.fetch(FakeSession(ok_reply()), now=1000.0))  # type: ignore[arg-type]
    sess = FakeSession(FakeResponse(304))
    payload = asyncio.run(noaa_kp.fetch(sess, now=1000.0 + 900))  # type: ignore[arg-type]
    headers = sess.calls[0]["headers"]
    assert headers["If-None-Match"] == '"12c5-65ff"'
    assert headers["If-Modified-Since"] == "Tue, 10 Nov 2026 18:18:59 GMT"
    assert payload["json"]["kp"] == 3.0 and "stale" not in payload


def test_offline_serves_the_last_reading_as_stale() -> None:
    asyncio.run(noaa_kp.fetch(FakeSession(ok_reply()), now=1000.0))  # type: ignore[arg-type]
    noaa_kp.reset_for_tests()
    for failure in (OSError("network unreachable"), FakeResponse(503), FakeResponse(200, b"<html>")):
        payload = asyncio.run(noaa_kp.fetch(FakeSession(failure), now=5000.0))  # type: ignore[arg-type]
        assert payload["stale"] is True
        assert payload["items"][0]["title"].startswith("Kp 3.00")
        assert payload["liveError"]


def test_source_row_end_to_end(monkeypatch: pytest.MonkeyPatch) -> None:
    sess = FakeSession(ok_reply())

    async def fake_session() -> FakeSession:
        return sess

    monkeypatch.setattr(sources, "session", fake_session)
    sources.save([_row()])
    asyncio.run(sources.poll(now=1000.0))
    live = sources.snapshot()["noaa-kp"]
    assert live["ok"] is True and live["kind"] == "http" and live["feed"] is False
    assert live["items"][0]["title"] == "Kp 3.00 · unsettled"
    assert live["json"]["history"][-1] == 3.0
    assert sources._due["noaa-kp"] == 1000.0 + 900
    assert sources.headlines() == []


def test_first_fetch_offline_backs_off_and_stays_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_session() -> FakeSession:
        return FakeSession(OSError("offline"))

    monkeypatch.setattr(sources, "session", fake_session)
    sources.save([_row()])
    asyncio.run(sources.poll(now=1000.0))
    live = sources.snapshot()["noaa-kp"]
    assert live["ok"] is False and "offline" in live["error"]
    assert not live.get("items")
    assert sources._due["noaa-kp"] == 1000.0 + noaa_kp.RETRY_S


def test_a_failure_served_from_cache_stays_ok_but_backs_off(monkeypatch: pytest.MonkeyPatch) -> None:
    asyncio.run(noaa_kp.fetch(FakeSession(ok_reply()), now=1000.0))  # type: ignore[arg-type]
    sess = FakeSession(OSError("network unreachable"), ok_reply())

    async def fake_session() -> FakeSession:
        return sess

    monkeypatch.setattr(sources, "session", fake_session)
    sources.save([_row()])
    asyncio.run(sources.poll(now=5000.0))
    live = sources.snapshot()["noaa-kp"]
    assert live["ok"] is True and live["stale"] is True
    assert "network unreachable" in live["liveError"]
    assert live["items"][0]["title"] == "Kp 3.00 · unsettled"
    assert sources._due["noaa-kp"] == 5000.0 + noaa_kp.RETRY_S

    retry = 5000.0 + noaa_kp.RETRY_S
    asyncio.run(sources.poll(now=retry))
    assert len(sess.calls) == 2
    live = sources.snapshot()["noaa-kp"]
    assert live["ok"] is True and "stale" not in live and "liveError" not in live
    assert sources._due["noaa-kp"] == retry + 900


def test_consent_gate_still_applies(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(source_consent, "allowed", lambda host: False)

    async def no_session() -> FakeSession:
        raise AssertionError("must not fetch without consent")

    monkeypatch.setattr(sources, "session", no_session)
    row = _row()
    asyncio.run(sources._fetch_live(row))
    assert sources._live["noaa-kp"]["needsConsent"] == noaa_kp.HOST
