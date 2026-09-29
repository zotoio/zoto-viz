"""Regression: each carousel picture source shows its own stills, or its own bundled sample.

QE pick-every-view @20fa18a7: ``plugin:carousel:apod`` rendered NASA IOTD stills and
``plugin:carousel:earth-iotd`` rendered Commons POTD stills. The live feeds had failed
(APOD DEMO_KEY 429, NASA Science feed malformed XML, Commons 403, NASA 502 on oversized
enclosures), the row went ``ok: false`` with no items, and the carousel kept the previous
source's slides. These tests mock the network; nothing here makes a live call.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import pytest

from service import sources

# Each source's own image host (suffix match) and the hosts of the sibling sources it must never show.
OWN_HOST = {
    "nasa": "www.nasa.gov",
    "apod": "apod.nasa.gov",
    "earth-iotd": "science.nasa.gov",
    "commons-potd": "wikimedia.org",
}
PICTURED = tuple(OWN_HOST)

NASA_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>NASA Image of the Day</title>
<item><title>Live IOTD still</title><link>https://www.nasa.gov/image-detail/live/</link>
<enclosure url="https://www.nasa.gov/wp-content/uploads/2026/09/live-iotd.jpg" length="4500000" type="image/jpeg"/></item>
</channel></rss>
"""

NASA_RSS_OVERSIZED = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>NASA Image of the Day</title>
<item><title>Pinwheel</title><link>https://www.nasa.gov/image-detail/m101-lg/</link>
<enclosure url="https://www.nasa.gov/wp-content/uploads/2026/09/m101-lg.jpg" length="64440402" type="image/jpeg"/></item>
<item><title>Fits</title><link>https://www.nasa.gov/image-detail/fits/</link>
<enclosure url="https://www.nasa.gov/wp-content/uploads/2026/09/fits.jpg" length="4500000" type="image/jpeg"/></item>
</channel></rss>
"""

APOD_JSON = json.dumps([
    {"date": "2026-09-28", "title": "Live APOD still", "explanation": "x", "media_type": "image",
     "url": "https://apod.nasa.gov/apod/image/2609/live_1024.jpg",
     "hdurl": "https://apod.nasa.gov/apod/image/2609/live_4000.jpg"},
])

# Verbatim shape of the live science.nasa.gov feed: `"xmlns:media=` has no space before it.
EARTH_RSS_GLUED = """<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"
\txmlns:content="http://purl.org/rss/1.0/modules/content/"
\t xmlns:apod="https://science.nasa.gov/apod/"xmlns:media="http://search.yahoo.com/mrss/" >
<channel><title>NASA Science</title>
<item><title>Live Earth still</title><link>https://science.nasa.gov/earth/earth-observatory/live/</link>
<content:encoded><![CDATA[<img src="https://assets.science.nasa.gov/dynamicimage/assets/science/esd/eo/images/iotd/2026/live/live.jpg"/>]]></content:encoded>
</item></channel></rss>
"""

COMMONS_ATOM = """<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Wikimedia Commons picture of the day feed</title>
<entry><title>Live Commons still</title><link href="https://commons.wikimedia.org/wiki/Special:FeedItem/potd/x"/>
<summary type="html">&lt;img src=&quot;https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/Live.jpg/960px-Live.jpg&quot; /&gt;</summary>
</entry></feed>
"""

LIVE_BODY = {
    "nasa": (NASA_RSS, "application/rss+xml"),
    "apod": (APOD_JSON, "application/json"),
    "earth-iotd": (EARTH_RSS_GLUED, "application/rss+xml"),
    "commons-potd": (COMMONS_ATOM, "application/atom+xml"),
}


@pytest.fixture(autouse=True)
def _iso(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> list[str]:
    home = tmp_path / "home"
    user = home / ".zoto-viz"
    user.mkdir(parents=True)
    monkeypatch.setattr(sources.paths, "user_dir", lambda: user)
    monkeypatch.setattr(Path, "home", staticmethod(lambda: home))
    monkeypatch.setattr(sources.agent_assets, "check_url", lambda u: u.strip())
    prefetched: list[str] = []
    # Still prefetch would hit the network; record instead.
    monkeypatch.setattr(sources, "_schedule_prefetch", lambda items: prefetched.extend(str(i.get("image") or "") for i in items))
    sources.reset_for_tests()
    return prefetched


def _row(sid: str) -> dict[str, Any]:
    return next(r for r in sources.ensure() if r["id"] == sid)


def _which(url: str) -> str:
    for sid, frag in (
        ("apod", "api.nasa.gov/planetary/apod"),
        ("nasa", "www.nasa.gov/feeds/iotd-feed"),
        ("earth-iotd", "science.nasa.gov/feed/earth-observatory"),
        ("commons-potd", "commons.wikimedia.org/w/api.php"),
    ):
        if frag in url:
            return sid
    raise AssertionError(f"unexpected fetch {url}")


def _mock_net(monkeypatch: pytest.MonkeyPatch, fail: dict[str, BaseException] | None = None,
              bodies: dict[str, tuple[str, str]] | None = None) -> list[str]:
    calls: list[str] = []
    fail = fail or {}
    bodies = {**LIVE_BODY, **(bodies or {})}

    async def fake(url: str) -> tuple[str, str]:
        calls.append(url)
        sid = _which(url)
        if sid in fail:
            raise fail[sid]
        return bodies[sid]

    monkeypatch.setattr(sources, "_http_body", fake)
    return calls


def _host(url: str) -> str:
    return (urlparse(url).hostname or "").lower()


def _own(sid: str, url: str) -> bool:
    h = _host(url)
    want = OWN_HOST[sid]
    return url.startswith("https://") and (h == want or h.endswith("." + want))


def _images(live: dict[str, Any]) -> list[str]:
    return [str(i.get("image") or "") for i in live.get("items") or [] if i.get("image")]


def _assert_only_own(sid: str, live: dict[str, Any]) -> None:
    imgs = _images(live)
    assert imgs, f"{sid}: no stills at all"
    for url in imgs:
        assert _own(sid, url), f"{sid} shows another host's image: {url}"
        for other in PICTURED:
            if other != sid and not (OWN_HOST[other].endswith(OWN_HOST[sid]) or OWN_HOST[sid].endswith(OWN_HOST[other])):
                assert not _own(other, url), f"{sid} shows {other}'s image {url}"


def _sample_images(sid: str) -> set[str]:
    doc = json.loads((sources.SAMPLE_DIR / f"{sid}.demo.json").read_text(encoding="utf-8"))
    return {i["image"] for i in doc["items"]}


# --- live success: each source's own stills, no sample flag ---------------------------------

@pytest.mark.parametrize("sid", PICTURED)
def test_live_feed_shows_its_own_stills(sid: str, monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_net(monkeypatch)
    live = asyncio.run(sources.fetch_one(_row(sid)))
    assert live["ok"] is True
    assert not live.get("demo") and not live.get("sample")
    _assert_only_own(sid, live)
    assert any("live" in u.lower() for u in _images(live)), _images(live)


# --- live failure: own sample, flagged, never another source's ------------------------------

FAILURES = {
    "502": ValueError("http 502"),
    "429": ValueError("http 429"),
    "403": ValueError("http 403"),
    "timeout": asyncio.TimeoutError(),
    "bad-xml": ValueError("not well-formed (invalid token): line 8, column 45"),
}


@pytest.mark.parametrize("why", sorted(FAILURES))
@pytest.mark.parametrize("sid", PICTURED)
def test_live_failure_serves_own_sample_with_flag(sid: str, why: str, monkeypatch: pytest.MonkeyPatch,
                                                  _iso: list[str]) -> None:
    _mock_net(monkeypatch, fail={sid: FAILURES[why]})
    live = asyncio.run(sources.fetch_one(_row(sid)))
    snap = sources.snapshot()[sid]
    for row in (live, snap):
        assert row["ok"] is True, "carousel only binds ok rows; the sample must reach it"
        assert row["demo"] is True and row["sample"] is True
        assert row["feed"] is False, "demo titles stay off the news ticker"
        assert "DEMO" in row["sampleLabel"]
        assert row["liveError"], "the live failure stays visible"
        _assert_only_own(sid, row)
        assert set(_images(row)) <= _sample_images(sid)
    # prefetch only ever asks for this source's own stills
    assert _iso and all(_own(sid, u) for u in _iso)


def test_all_four_failing_at_once_never_share_a_still(monkeypatch: pytest.MonkeyPatch) -> None:
    """The QE pairs: apod vs nasa and earth-iotd vs commons-potd must never match."""
    _mock_net(monkeypatch, fail={sid: ValueError("http 502") for sid in PICTURED})
    snap = asyncio.run(sources.poll(now=1_000.0))
    seen: dict[str, str] = {}
    for sid in PICTURED:
        assert snap[sid]["demo"] is True
        _assert_only_own(sid, snap[sid])
        for url in _images(snap[sid]):
            assert url not in seen, f"{sid} and {seen.get(url)} share {url}"
            seen[url] = sid
    assert not set(_images(snap["apod"])) & set(_images(snap["nasa"]))
    assert not set(_images(snap["earth-iotd"])) & set(_images(snap["commons-potd"]))


def test_recovers_to_live_after_sample(monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_net(monkeypatch, fail={"apod": ValueError("http 429")})
    assert asyncio.run(sources.fetch_one(_row("apod")))["demo"] is True
    _mock_net(monkeypatch)
    live = asyncio.run(sources.fetch_one(_row("apod")))
    assert live["ok"] is True and not live.get("demo")
    assert _images(live) == ["https://apod.nasa.gov/apod/image/2609/live_4000.jpg"]


# --- per-source specifics ------------------------------------------------------------------

def test_nasa_skips_enclosures_the_still_proxy_would_refuse(monkeypatch: pytest.MonkeyPatch) -> None:
    """m101-lg.jpg is 64 MB; the proxy caps at agent_assets.MAX_BYTES and answered 502."""
    _mock_net(monkeypatch, bodies={"nasa": (NASA_RSS_OVERSIZED, "application/rss+xml")})
    live = asyncio.run(sources.fetch_one(_row("nasa")))
    assert not live.get("demo")
    assert _images(live) == ["https://www.nasa.gov/wp-content/uploads/2026/09/fits.jpg"]


def test_nasa_with_only_oversized_stills_serves_own_sample(monkeypatch: pytest.MonkeyPatch) -> None:
    only_big = NASA_RSS_OVERSIZED.replace('length="4500000"', 'length="30000000"')
    _mock_net(monkeypatch, bodies={"nasa": (only_big, "application/rss+xml")})
    live = asyncio.run(sources.fetch_one(_row("nasa")))
    assert live["demo"] is True and live["liveError"] == "no pictured items"
    _assert_only_own("nasa", live)


def test_apod_rate_limit_json_serves_apod_sample(monkeypatch: pytest.MonkeyPatch) -> None:
    body = json.dumps({"error": {"code": "OVER_RATE_LIMIT", "message": "rate limit"}})
    _mock_net(monkeypatch, bodies={"apod": (body, "application/json")})
    live = asyncio.run(sources.fetch_one(_row("apod")))
    assert live["demo"] is True
    _assert_only_own("apod", live)
    assert all(_host(u) == "apod.nasa.gov" for u in _images(live))


def test_earth_iotd_parses_glued_attribute_feed() -> None:
    parsed = sources.parse_rss(EARTH_RSS_GLUED)
    assert parsed["title"] == "NASA Science"
    assert parsed["items"][0]["image"].startswith("https://assets.science.nasa.gov/")


def test_repointed_row_gets_no_shipped_sample(monkeypatch: pytest.MonkeyPatch) -> None:
    """An operator who points `nasa` at another feed never sees NASA's sample pictures."""
    sources.upsert({"id": "nasa", "type": "rss", "url": "https://example.com/feed.xml"})

    async def fail(url: str) -> tuple[str, str]:
        raise ValueError("http 502")

    monkeypatch.setattr(sources, "_http_body", fail)
    live = asyncio.run(sources.fetch_one(_row("nasa")))
    assert live["ok"] is False and not live.get("demo") and not live.get("items")


def test_demo_rows_stay_off_backend_ticker(monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_net(monkeypatch, fail={"apod": ValueError("http 429")})
    asyncio.run(sources.fetch_one(_row("apod")))
    asyncio.run(sources.fetch_one(_row("nasa")))
    srcs = {h["source"] for h in sources.headlines()}
    assert "nasa" in srcs and "apod" not in srcs


@pytest.mark.parametrize("sid", PICTURED)
def test_bundled_sample_is_labelled_demo_and_own_host(sid: str) -> None:
    path = sources.SAMPLE_DIR / f"{sid}.demo.json"
    raw = path.read_bytes()
    assert len(raw) <= sources.MAX_SAMPLE_BYTES
    doc = json.loads(raw)
    assert doc["demo"] is True and doc["source"] == sid and "DEMO" in doc["label"]
    assert len(doc["items"]) >= 3
    for it in doc["items"]:
        assert it["title"] and _own(sid, it["image"]), it
    others = set().union(*(_sample_images(o) for o in PICTURED if o != sid))
    assert not _sample_images(sid) & others
