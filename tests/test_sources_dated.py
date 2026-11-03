from __future__ import annotations

import asyncio
import json
from datetime import date

import pytest

from service import sources

ROW = {
    "id": "botz",
    "type": "http",
    "url": "https://botz.ai/archive/day/{date}?n=24",
    "fields": {"list": "editorials", "title": "entry.article.title", "link": "entry.article.url"},
}


def _doc(*titles: str) -> str:
    return json.dumps({"editorials": [
        {"entry": {"article": {"title": t, "url": f"https://example.com/{i}"}}} for i, t in enumerate(titles)
    ]})


def test_dated_url_and_candidates() -> None:
    d = date(2026, 11, 3)
    assert sources.dated_url(ROW["url"], d) == "https://botz.ai/archive/day/2026-11-03?n=24"
    assert sources.dated_candidates(ROW["url"], d) == [
        "https://botz.ai/archive/day/2026-11-03?n=24",
        "https://botz.ai/archive/day/2026-11-02?n=24",
    ]
    assert sources.dated_candidates("https://example.com/x") == ["https://example.com/x"]
    assert "{date}" not in sources.resolve_fetch_url(ROW["url"])


def test_normalize_keeps_date_token() -> None:
    row = sources.normalize(dict(ROW))
    assert row["url"].endswith("/{date}?n=24")


def _run(monkeypatch: pytest.MonkeyPatch, replies: dict[str, object]) -> dict:
    today = date.today().isoformat()

    async def fake(url: str) -> tuple[str, str]:
        r = replies["today"] if today in url else replies["other"]
        if isinstance(r, Exception):
            raise r
        return str(r), "application/json"

    monkeypatch.setattr(sources, "_http_body", fake)
    from service import source_consent
    monkeypatch.setattr(source_consent, "allowed", lambda host: True)
    monkeypatch.setattr(sources, "_schedule_prefetch", lambda items: None)
    row = sources.normalize(dict(ROW))
    asyncio.run(sources._fetch_live(row))
    return sources._live["botz"]


def test_today_then_yesterday_then_stale(monkeypatch: pytest.MonkeyPatch) -> None:
    today = date.today().isoformat()
    live = _run(monkeypatch, {"today": _doc("Fresh one"), "other": ValueError("unused")})
    assert live["ok"] and live["items"][0]["title"] == "Fresh one"
    assert today in live["fetchedUrl"]

    live = _run(monkeypatch, {"today": ValueError("http 404"), "other": _doc("Older")})
    assert live["ok"] and live["items"][0]["title"] == "Older"
    assert today not in live["fetchedUrl"]

    live = _run(monkeypatch, {"today": ValueError("http 503"), "other": ValueError("http 503")})
    assert live["ok"] and live["stale"] is True
    assert live["items"][0]["title"] == "Older"
